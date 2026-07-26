// Shared domain logic for Rabbi Emanuel's Assistant edge functions.
//
// rabbi-public (the app API) and rabbi-sms-inbound (the text-in bot) must create shailos and
// bookings through EXACTLY the same code paths — same promise calculation, same capacity checks,
// same confirmations — so the logic lives here rather than in either function.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { atLocalTime, computeEta, localDateKey, localParts } from "./rabbiEta.ts";

export interface RabbiSettings {
  timezone: string;
  erev_cutoff_minutes?: number;
  daily_shailah_capacity: number;
  same_day_cutoff_hour: number;
  same_day_promise_hour: number;
  calls_auto_confirm: boolean;
  meetings_auto_confirm: boolean;
  sms_notifications_enabled: boolean;
  briefing_enabled: boolean;
  rabbi_phone: string | null;
}

/**
 * Every Shabbos and yom tov in the next `days`, as yyyy-mm-dd. Fed to computeEta so a promise
 * never lands on a day the Rov cannot answer. An empty set (calendar not synced yet) degrades
 * to the old behaviour: Saturday only.
 */
export async function loadNoWorkDates(
  admin: SupabaseClient, tz: string, days = 45,
): Promise<{ noWorkDates: Set<string>; candleTimes: Map<string, string> }> {
  const from = localDateKey(new Date(), tz);
  const to = localDateKey(new Date(Date.now() + days * 86_400_000), tz);
  const { data } = await admin.from("rabbi_calendar_days")
    .select("on_date, no_work, candles_at").gte("on_date", from).lte("on_date", to);
  const noWorkDates = new Set<string>();
  const candleTimes = new Map<string, string>();
  for (const d of data ?? []) {
    if (d.no_work) noWorkDates.add(String(d.on_date));
    if (d.candles_at) candleTimes.set(String(d.on_date), String(d.candles_at));
  }
  return { noWorkDates, candleTimes };
}

export async function loadRabbiSettings(admin: SupabaseClient): Promise<RabbiSettings> {
  const { data } = await admin.from("rabbi_settings").select("*").eq("id", 1).maybeSingle();
  return (data as RabbiSettings | null) ?? {
    timezone: "Europe/London", erev_cutoff_minutes: 90, daily_shailah_capacity: 10, same_day_cutoff_hour: 15,
    same_day_promise_hour: 22, calls_auto_confirm: true, meetings_auto_confirm: false,
    sms_notifications_enabled: true, briefing_enabled: true, rabbi_phone: null,
  };
}

// ---------------------------------------------------------------------------
// Slot expansion: released windows → discrete bookable slots, minus requested/confirmed
// bookings and the rabbi's fixed weekly timetable.
export interface SlotOut {
  releaseId: string;
  slotType: "call" | "meeting";
  startsAt: string;
  endsAt: string;
  location: string | null;
}

const MIN_NOTICE_MS = 60 * 60 * 1000; // slots must start at least an hour from now

function minutesOfDay(d: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  return Number(parts.hour === "24" ? "0" : parts.hour) * 60 + Number(parts.minute);
}

/** How far ahead the weekly pattern is projected. */
const HORIZON_DAYS = 21;

/** A window of bookable time on one real date, from either source. */
interface Window {
  /** rabbi_slot_releases.id, or `weekly:<rabbi_availability.id>` for the recurring pattern. */
  releaseId: string;
  startMs: number;
  endMs: number;
  durationMinutes: number;
  location: string | null;
}

const hhmm = (t: string): [number, number] => {
  const [h, m] = String(t).split(":").map(Number);
  return [h || 0, m || 0];
};

/** Kept separate so the cutoff check can name the day before the rest of the loop runs. */
const slotStartOf = (ms: number) => new Date(ms);

export async function expandSlots(
  admin: SupabaseClient,
  slotType: "call" | "meeting",
  tz: string,
  limit = 60,
  erevCutoffMinutes = 90,
): Promise<SlotOut[]> {
  const now = new Date();
  const nowIso = now.toISOString();
  const horizon = new Date(Date.now() + HORIZON_DAYS * 86_400_000).toISOString();
  const [releasesQ, weeklyQ, bookingsQ, blocksQ, offQ, calQ] = await Promise.all([
    admin.from("rabbi_slot_releases").select("*")
      .eq("slot_type", slotType).eq("status", "open")
      .gt("ends_at", nowIso).lt("starts_at", horizon)
      .order("starts_at"),
    admin.from("rabbi_availability").select("*").eq("slot_type", slotType).eq("is_active", true),
    admin.from("rabbi_bookings").select("starts_at, ends_at")
      .in("status", ["requested", "confirmed"]).gt("ends_at", nowIso),
    admin.from("rabbi_timetable_blocks").select("weekday, start_time, end_time").eq("is_active", true),
    admin.from("rabbi_time_off").select("on_date").gte("on_date", localDateKey(now, tz)),
    admin.from("rabbi_calendar_days").select("on_date, no_work, candles_at")
      .gte("on_date", localDateKey(now, tz))
      .lte("on_date", localDateKey(new Date(Date.now() + HORIZON_DAYS * 86_400_000), tz)),
  ]);
  const bookings = (bookingsQ.data ?? []).map((b) => ({ s: Date.parse(b.starts_at), e: Date.parse(b.ends_at) }));
  const blocks = blocksQ.data ?? [];
  const daysOff = new Set((offQ.data ?? []).map((d) => String(d.on_date)));
  // Yom tov and Shabbos are closed outright; on an erev, appointments stop a configurable
  // while before candle-lighting so nobody is booked into the run-up.
  const closed = new Set<string>();
  const lastBookableMs = new Map<string, number>();
  const cutoffMs = erevCutoffMinutes * 60_000;
  for (const c of calQ.data ?? []) {
    const date = String(c.on_date);
    if (c.no_work) closed.add(date);
    if (c.candles_at) lastBookableMs.set(date, Date.parse(String(c.candles_at)) - cutoffMs);
  }

  // The weekly pattern, projected onto real dates, plus any one-off releases. A release on the
  // same day as the pattern is an addition, not a replacement — overlapping starts are deduped
  // below, so releasing an extra hour never silently cancels the recurring one.
  const windows: Window[] = [];

  for (const r of releasesQ.data ?? []) {
    windows.push({
      releaseId: r.id as string,
      startMs: Date.parse(r.starts_at),
      endMs: Date.parse(r.ends_at),
      durationMinutes: r.duration_minutes as number,
      location: (r.location as string | null) ?? null,
    });
  }

  for (let day = 0; day <= HORIZON_DAYS; day++) {
    const probe = new Date(now.getTime() + day * 86_400_000);
    const p = localParts(probe, tz);
    const key = localDateKey(probe, tz);
    if (p.weekday === 6) continue;                             // never Shabbos
    if (closed.has(key)) continue;                             // yom tov, per Hebcal
    if (daysOff.has(key)) continue;                            // he told us he's away
    for (const a of weeklyQ.data ?? []) {
      if ((a.weekday as number) !== p.weekday) continue;
      const [sh, sm] = hhmm(a.start_time as string);
      const [eh, em] = hhmm(a.end_time as string);
      windows.push({
        releaseId: `weekly:${a.id}`,
        startMs: atLocalTime(probe, tz, 0, sh, sm).getTime(),
        endMs: atLocalTime(probe, tz, 0, eh, em).getTime(),
        durationMinutes: a.duration_minutes as number,
        location: (a.location as string | null) ?? null,
      });
    }
  }

  windows.sort((a, b) => a.startMs - b.startMs);

  const out: SlotOut[] = [];
  const seen = new Set<number>();
  for (const w of windows) {
    const dur = w.durationMinutes * 60_000;
    for (let s = w.startMs; s + dur <= w.endMs; s += dur) {
      const e = s + dur;
      if (s < Date.now() + MIN_NOTICE_MS) continue;
      if (seen.has(s)) continue;                                  // two windows, same minute
      const dayKey = localDateKey(slotStartOf(s), tz);
      if (closed.has(dayKey)) continue;                           // a one-off release on yom tov
      const latest = lastBookableMs.get(dayKey);
      if (latest !== undefined && e > latest) continue;           // into the erev run-up
      if (bookings.some((b) => s < b.e && e > b.s)) continue;
      const slotStart = new Date(s);
      const wd = localParts(slotStart, tz).weekday;
      const startMin = minutesOfDay(slotStart, tz);
      const endMin = startMin + w.durationMinutes;
      const blocked = blocks.some((bl) => {
        if (bl.weekday !== wd) return false;
        const [bh, bm] = hhmm(bl.start_time as string);
        const [eh, em] = hhmm(bl.end_time as string);
        return startMin < eh * 60 + em && endMin > bh * 60 + bm;
      });
      if (blocked) continue;
      seen.add(s);
      out.push({
        releaseId: w.releaseId, slotType, startsAt: slotStart.toISOString(),
        endsAt: new Date(e).toISOString(), location: w.location,
      });
      if (out.length >= limit) return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function fmtSlot(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Shabbos and yom tov, as they matter to somebody texting in.

export interface RestWindow {
  /** "soon" — candle lighting is close. "in" — it has already come in. */
  phase: "soon" | "in";
  /** What to call it: "Shabbos", or a yom tov by its own name. */
  label: string;
  /** Minutes until candle lighting ("soon"), or until it goes out ("in"). */
  minutes: number;
  /** When he is back, in the words a person would use: "after Shabbos tonight". */
  backWhen: string;
}

/**
 * Somebody texting a shailah forty minutes before candle lighting is owed the truth: the Rov is
 * about to be away from a phone for twenty-five hours, and an answer is very unlikely to come
 * before then. Saying so costs one sentence. Not saying it leaves a person watching a handset
 * through hadlokas neiros, which is precisely the anxiety this service exists to end.
 *
 * Returns null whenever there is nothing to say — which is almost all of the time.
 */
export async function restWindow(
  admin: SupabaseClient, tz: string, withinMinutes = 60, now = new Date(),
): Promise<RestWindow | null> {
  const from = localDateKey(new Date(now.getTime() - 2 * 86_400_000), tz);
  const to = localDateKey(new Date(now.getTime() + 3 * 86_400_000), tz);
  const { data } = await admin.from("rabbi_calendar_days")
    .select("on_date, kind, label, no_work, candles_at, havdalah_at")
    .gte("on_date", from).lte("on_date", to).order("on_date");
  const days = data ?? [];
  if (!days.length) return null;

  const nowMs = now.getTime();

  // Already in it: past a candle lighting, and the havdalah that closes it is still ahead.
  for (const d of days) {
    if (!d.candles_at) continue;
    const inAt = Date.parse(String(d.candles_at));
    const closing = days.find((x) => x.havdalah_at && Date.parse(String(x.havdalah_at)) > inAt);
    if (!closing) continue;
    const outAt = Date.parse(String(closing.havdalah_at));
    if (nowMs >= inAt && nowMs < outAt) {
      return {
        phase: "in",
        label: restLabel(closing),
        minutes: Math.round((outAt - nowMs) / 60_000),
        backWhen: `after ${restLabel(closing)}`,
      };
    }
  }

  // Not in it yet: is it close enough to matter?
  const nextCandles = days
    .filter((d) => d.candles_at && Date.parse(String(d.candles_at)) > nowMs)
    .sort((a, b) => Date.parse(String(a.candles_at)) - Date.parse(String(b.candles_at)))[0];
  if (!nextCandles) return null;
  const inAt = Date.parse(String(nextCandles.candles_at));
  const minutes = Math.round((inAt - nowMs) / 60_000);
  if (minutes > withinMinutes) return null;

  const rest = days.find((x) => x.no_work && Date.parse(String(x.on_date)) >= Date.parse(String(nextCandles.on_date)));
  const label = rest ? restLabel(rest) : "Shabbos";
  return { phase: "soon", label, minutes, backWhen: `after ${label}` };
}

/** "Shabbos Eikev" is for the diary. Somebody texting just needs "Shabbos". */
function restLabel(day: { kind?: string | null; label?: string | null }): string {
  if (day.kind === "shabbos") return "Shabbos";
  const l = (day.label ?? "").trim();
  return l && day.kind !== "shabbos" ? l : "Yom Tov";
}

// ---------------------------------------------------------------------------
// Creation paths shared by app and SMS bot.
export interface CreateShailahInput {
  profileId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  channel: "app" | "sms" | "whatsapp" | "staff";
  categoryId?: string | null;
  urgencyTierId?: string | null;
  question: string;
}

export interface CreatedShailah {
  id: string;
  ref: string;
  due_at: string;
  expected_reply_text: string;
}

export async function createShailah(
  admin: SupabaseClient,
  settings: RabbiSettings,
  input: CreateShailahInput,
): Promise<{ shailah?: CreatedShailah; error?: string }> {
  const [{ data: category }, { data: tier }, { count: queueAhead }, calendar] = await Promise.all([
    input.categoryId
      ? admin.from("rabbi_categories").select("id, default_same_day, is_sensitive").eq("id", input.categoryId).maybeSingle()
      : Promise.resolve({ data: null }),
    input.urgencyTierId
      ? admin.from("rabbi_urgency_tiers").select("id, promise_type, promise_hours").eq("id", input.urgencyTierId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("rabbi_shailos").select("id", { count: "exact", head: true })
      .in("status", ["new", "triaged", "in_progress"]),
    loadNoWorkDates(admin, settings.timezone),
  ]);

  const eta = computeEta({
    now: new Date(),
    noWorkDates: calendar.noWorkDates,
    candleTimes: calendar.candleTimes,
    tier: {
      promiseType: (tier?.promise_type ?? "queue_based") as "same_day" | "hours" | "queue_based",
      promiseHours: tier?.promise_hours ?? null,
    },
    categorySameDay: Boolean(category?.default_same_day),
    queueAhead: queueAhead ?? 0,
    settings: {
      timezone: settings.timezone,
      dailyShailahCapacity: settings.daily_shailah_capacity,
      sameDayCutoffHour: settings.same_day_cutoff_hour,
      sameDayPromiseHour: settings.same_day_promise_hour,
    },
  });

  const { data, error } = await admin.from("rabbi_shailos").insert({
    profile_id: input.profileId ?? null,
    contact_name: input.contactName ?? null,
    contact_phone: input.contactPhone ?? null,
    channel: input.channel,
    category_id: input.categoryId ?? null,
    urgency_tier_id: input.urgencyTierId ?? null,
    question: input.question,
    is_sensitive: Boolean(category?.is_sensitive),
    due_at: eta.dueAt.toISOString(),
    expected_reply_text: eta.humanText,
  }).select("id, ref, due_at, expected_reply_text").single();
  if (error) return { error: error.message };
  return { shailah: data as CreatedShailah };
}

export interface CreateBookingInput {
  profileId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  channel: "app" | "sms" | "whatsapp" | "staff";
  slot: SlotOut;
  purpose?: string | null;
}

export async function createBooking(
  admin: SupabaseClient,
  settings: RabbiSettings,
  input: CreateBookingInput,
  // deno-lint-ignore no-explicit-any
): Promise<{ booking?: any; autoConfirmed?: boolean; error?: string }> {
  // Re-expand to confirm the slot is still genuinely free (race-safe enough for one rabbi).
  const fresh = await expandSlots(admin, input.slot.slotType, settings.timezone, 60, settings.erev_cutoff_minutes ?? 90);
  const stillFree = fresh.some((s) => s.releaseId === input.slot.releaseId && s.startsAt === input.slot.startsAt);
  if (!stillFree) return { error: "slot_taken" };

  const autoConfirm = input.slot.slotType === "call" ? settings.calls_auto_confirm : settings.meetings_auto_confirm;
  // A slot from the weekly pattern has no release row to point at ("weekly:<availability id>"),
  // and the column is a FK to rabbi_slot_releases — so only a real release id goes in.
  const releaseId = input.slot.releaseId.startsWith("weekly:") ? null : input.slot.releaseId;
  const { data, error } = await admin.from("rabbi_bookings").insert({
    profile_id: input.profileId ?? null,
    contact_name: input.contactName ?? null,
    contact_phone: input.contactPhone ?? null,
    slot_release_id: releaseId,
    slot_type: input.slot.slotType,
    starts_at: input.slot.startsAt,
    ends_at: input.slot.endsAt,
    purpose: input.purpose ? input.purpose.slice(0, 500) : null,
    status: autoConfirm ? "confirmed" : "requested",
    channel: input.channel,
  }).select().single();
  if (error) return { error: error.message };
  return { booking: data, autoConfirmed: autoConfirm };
}

// Fire AI triage without blocking the caller; the edge runtime keeps the promise alive.
export function fireTriage(shailahId: string) {
  const p = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/rabbi-triage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ shailahId }),
  }).catch((e) => console.error("[rabbiCore] triage kick failed", e));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
}
