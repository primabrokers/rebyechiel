import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { json } from "../_shared/cors.ts";
import { isCronAuthorised } from "../_shared/rabbiCronAuth.ts";

/**
 * Fills rabbi_calendar_days from Hebcal, for the location in rabbi_settings.
 *
 * Two Hebcal endpoints, both free and unauthenticated:
 *   /hebcal  — holidays, parsha, candle-lighting and havdalah for a date range
 *   /zmanim  — the day's zmanim (alos, sunrise, sof zman shma, mincha, tzeis …)
 *
 * Runs nightly (cron) and on demand when the Rov changes the location. Idempotent: every row is
 * an upsert, so re-running only refreshes. Nothing here decides halacha — it records Hebcal's
 * published times so the promise engine and the slot maths can stop pretending the only day
 * that matters is Saturday.
 */
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/** How far ahead to keep the calendar. Bookings look 21 days out; a year is cheap and lets the
 *  diary show yom tov long before anyone tries to book over it. */
const DAYS_AHEAD = 400;

interface HebcalItem {
  title: string;
  date: string;            // ISO date, or ISO datetime for candles/havdalah
  category: string;        // holiday | candles | havdalah | parashat | roshchodesh | ...
  subcat?: string;         // major | minor | fast | modern | shabbat
  yomtov?: boolean;
  hebrew?: string;
  memo?: string;
}

type Kind = "weekday" | "erev" | "shabbos" | "yomtov" | "chol_hamoed" | "fast";

interface DayRow {
  on_date: string;
  kind: Kind;
  label: string | null;
  parsha: string | null;
  no_work: boolean;
  candles_at: string | null;
  havdalah_at: string | null;
  zmanim: unknown | null;
  hebrew_date: string | null;
  synced_at: string;
}

const dayOf = (iso: string) => iso.slice(0, 10);

/** Hebcal writes chol hamoed as `Sukkot VI (CH''M)` or `Chol ha-Moed Pesach`, both. */
const isCholHamoed = (title: string) =>
  /chol\s*ha-?moed|hoshana raba|\(ch[\u2019'\`]{0,2}m\)/i.test(title);

/**
 * Hebcal emits "Fast begins" / "Fast ends" as their own items: they are times of day, not the
 * name of the day, and using one as a label leaves the Rov looking at "Fast begins" where he
 * expects "Tzom Gedaliah".
 */
const isFastMarker = (title: string) => /^fast (begins|ends)$/i.test(title);

/**
 * Hebcal's own English titles, made plain and consistent with how the Rov's kehillah says them.
 * Anything not listed passes through unchanged — a wrong-but-recognisable name is far better
 * than a blank.
 */
function plainLabel(title: string): string {
  return title
    .replace(/^Erev /, "Erev ")
    .replace(/Shabbat/g, "Shabbos")
    .replace(/Sukkot/g, "Sukkos")
    .replace(/Shavuot/g, "Shavuos")
    .replace(/Simchat Torah/g, "Simchas Torah")
    .replace(/Rosh Hashana/g, "Rosh Hashanah")
    .replace(/Yom Kippur/g, "Yom Kippur")
    .replace(/Pesach/g, "Pesach")
    .replace(/Chanukah/g, "Chanukah")
    .replace(/Tish'a B'Av/g, "Tisha B'Av")
    .replace(/Asara B'Tevet/g, "Asarah B'Teves")
    .replace(/Ta'anit Esther/g, "Taanis Esther")
    .replace(/Ta'anit Bechorot/g, "Taanis Bechoros")
    .replace(/Tzom Gedaliah/g, "Tzom Gedaliah")
    .replace(/Shiva Asar B'Tammuz/g, "Shiva Asar B'Tammuz");
}

Deno.serve(async (req: Request) => {
  try {
    if (!(await isCronAuthorised(req))) return json({ error: "forbidden" }, 403);

    const { data: settings } = await admin.from("rabbi_settings").select("*").eq("id", 1).maybeSingle();
    const tz = settings?.timezone ?? "Europe/London";
    const geonameid = settings?.location_geonameid ?? 2643123;   // Manchester
    const lat = Number(settings?.location_latitude ?? 53.48102);
    const lon = Number(settings?.location_longitude ?? -2.23679);
    const israel = Boolean(settings?.in_israel);

    const start = new Date();
    const end = new Date(Date.now() + DAYS_AHEAD * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    // --- holidays, parsha, candles, havdalah ------------------------------------------------
    const calUrl = new URL("https://www.hebcal.com/hebcal");
    calUrl.search = new URLSearchParams({
      v: "1", cfg: "json",
      start: iso(start), end: iso(end),
      maj: "on", min: "on", mod: "off", nx: "on", mf: "on", ss: "on", // holidays + rosh chodesh + special shabbosos
      s: "on",                     // parsha
      c: "on",                     // candle lighting
      M: "on",                     // havdalah at nightfall
      geo: "geoname", geonameid: String(geonameid),
      i: israel ? "on" : "off",
      lg: "s",                     // Sephardi-style transliteration ("Shabbat" -> handled above)
    }).toString();

    const calRes = await fetch(calUrl.toString(), { headers: { Accept: "application/json" } });
    if (!calRes.ok) {
      const body = await calRes.text();
      return json({ error: `hebcal ${calRes.status}: ${body.slice(0, 200)}` }, 502);
    }
    const cal = await calRes.json() as { items?: HebcalItem[] };
    const items = cal.items ?? [];

    const days = new Map<string, DayRow>();
    const now = new Date().toISOString();
    const dayFor = (date: string): DayRow => {
      let d = days.get(date);
      if (!d) {
        d = {
          on_date: date, kind: "weekday", label: null, parsha: null, no_work: false,
          candles_at: null, havdalah_at: null, zmanim: null, hebrew_date: null, synced_at: now,
        };
        days.set(date, d);
      }
      return d;
    };

    for (const it of items) {
      const date = dayOf(it.date);
      const d = dayFor(date);
      switch (it.category) {
        case "candles":
          d.candles_at = it.date;
          // Candles tonight means the day itself is an erev, unless it is already yom tov
          // (second day of a two-day yom tov lights from an existing yom tov).
          if (d.kind === "weekday") d.kind = "erev";
          break;
        case "havdalah":
          d.havdalah_at = it.date;
          break;
        case "parashat":
          d.parsha = plainLabel(it.title.replace(/^Parashat\s+/, ""));
          break;
        case "holiday": {
          const title = plainLabel(it.title);
          if (isFastMarker(it.title)) {
            // Tells us it is a fast, but must never become the day's name.
            if (d.kind === "weekday") d.kind = "fast";
            break;
          }
          // Keep the most significant label for a day that carries several.
          if (it.yomtov) {
            d.kind = "yomtov";
            d.no_work = true;
            d.label = title;
          } else if (isCholHamoed(title)) {
            if (d.kind !== "yomtov") { d.kind = "chol_hamoed"; }
            d.label ??= title;
          } else if (it.subcat === "fast") {
            if (d.kind === "weekday" || d.kind === "erev") { d.kind = "fast"; d.label ??= title; }
          } else {
            d.label ??= title;
          }
          break;
        }
        default:
          if (!isFastMarker(it.title)) d.label ??= plainLabel(it.title);
      }
      if (it.hebrew) d.hebrew_date ??= it.hebrew;
    }

    // Every Shabbos, whether or not Hebcal listed anything for it. This is the floor the app has
    // always had, now recorded as data rather than a `weekday === 6` check.
    for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
      const date = iso(new Date(t));
      const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (wd !== 6) continue;
      const d = dayFor(date);
      if (d.kind !== "yomtov") d.kind = "shabbos";
      d.no_work = true;
      d.label ??= d.parsha ? `Shabbos ${d.parsha}` : "Shabbos";
    }

    // --- zmanim, for the next fortnight only ------------------------------------------------
    // The Rov looks at today's and this week's; a year of zmanim would be a megabyte of JSON
    // nobody reads. Anything older simply has no zmanim recorded.
    const zStart = iso(start);
    const zEnd = iso(new Date(Date.now() + 14 * 86_400_000));
    const zUrl = new URL("https://www.hebcal.com/zmanim");
    zUrl.search = new URLSearchParams({
      cfg: "json", latitude: String(lat), longitude: String(lon), tzid: tz,
      start: zStart, end: zEnd,
    }).toString();
    const zRes = await fetch(zUrl.toString(), { headers: { Accept: "application/json" } });
    let zmanimDays = 0;
    if (zRes.ok) {
      // The range form returns { times: { sunrise: { "2026-07-26": "..." }, ... } }.
      const z = await zRes.json() as { times?: Record<string, Record<string, string>> };
      const byDate = new Map<string, Record<string, string>>();
      for (const [name, perDay] of Object.entries(z.times ?? {})) {
        if (typeof perDay !== "object" || perDay === null) continue;
        for (const [date, value] of Object.entries(perDay)) {
          const row = byDate.get(date) ?? {};
          row[name] = value;
          byDate.set(date, row);
        }
      }
      for (const [date, times] of byDate) {
        dayFor(date).zmanim = times;
        zmanimDays++;
      }
    } else {
      console.error("[rabbi-calendar] zmanim fetch failed", zRes.status, (await zRes.text()).slice(0, 200));
    }

    // --- write ------------------------------------------------------------------------------
    const rows = [...days.values()].sort((a, b) => a.on_date.localeCompare(b.on_date));
    // Chunked so one oversized statement can't fail the whole sync.
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await admin.from("rabbi_calendar_days")
        .upsert(rows.slice(i, i + 200), { onConflict: "on_date" });
      if (error) return json({ error: error.message }, 500);
    }
    await admin.from("rabbi_settings").update({ calendar_synced_at: now }).eq("id", 1);

    const noWork = rows.filter((r) => r.no_work).length;
    console.log(`[rabbi-calendar] ${rows.length} days (${noWork} no-work), ${zmanimDays} with zmanim, for ${settings?.location_name ?? "Manchester"}`);
    return json({
      ok: true, days: rows.length, noWorkDays: noWork, zmanimDays,
      location: settings?.location_name ?? "Manchester, United Kingdom",
      from: rows[0]?.on_date ?? null, to: rows.at(-1)?.on_date ?? null,
    });
  } catch (err) {
    console.error("[rabbi-calendar]", err);
    return json({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
