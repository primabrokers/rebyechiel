import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { preflight, json } from "../_shared/cors.ts";
import { isCronAuthorised } from "../_shared/rabbiCronAuth.ts";
import { callClaude, MODELS } from "../_shared/anthropic.ts";
import { atLocalHour, localParts } from "../_shared/rabbiEta.ts";
import { sendRabbiMessage } from "../_shared/rabbiMessaging.ts";

/**
 * Rabbi Emanuel's morning briefing. Cron-triggered each morning (see rabbi crons migration):
 * gathers today's fixed timetable, confirmed bookings, questions due today and anything overdue,
 * has Claude write a short warm summary, stores it (surfaced on the Today screen) and texts it
 * to the rabbi if enabled. Idempotent per day — a second invocation is a no-op.
 */
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  // verify_jwt is off for cron delivery — enforce our own auth before doing anything.
  if (!(await isCronAuthorised(req))) return json({ error: "forbidden" }, 403);
  try {
    const { data: settings } = await admin.from("rabbi_settings").select("*").eq("id", 1).maybeSingle();
    if (!settings?.briefing_enabled) return json({ ok: true, skipped: "disabled" });
    const tz = settings.timezone ?? "Europe/London";

    const now = new Date();
    const p = localParts(now, tz);
    // Day bounds: today 00:00 and 24:00 local, via the tested DST-safe helper.
    const dayStart = atLocalHour(now, tz, 0, 0);
    const dayEnd = atLocalHour(now, tz, 1, 0);

    // One briefing per local day.
    const { data: existing } = await admin.from("rabbi_messages")
      .select("id").eq("related_type", "briefing").gte("created_at", dayStart.toISOString()).limit(1);
    if ((existing ?? []).length > 0) return json({ ok: true, skipped: "already_sent" });

    const [blocksQ, bookingsQ, dueQ, overdueQ, newQ] = await Promise.all([
      admin.from("rabbi_timetable_blocks").select("label, start_time, end_time, block_type")
        .eq("is_active", true).eq("weekday", p.weekday).order("start_time"),
      admin.from("rabbi_bookings").select("ref, slot_type, starts_at, purpose, status, profile_id, contact_name")
        .in("status", ["confirmed", "requested"])
        .gte("starts_at", dayStart.toISOString()).lt("starts_at", dayEnd.toISOString())
        .order("starts_at"),
      admin.from("rabbi_shailos").select("ref, is_sensitive, ai_summary, due_at")
        .in("status", ["new", "triaged", "in_progress"])
        .gte("due_at", dayStart.toISOString()).lt("due_at", dayEnd.toISOString()),
      admin.from("rabbi_shailos").select("ref", { count: "exact", head: true })
        .in("status", ["new", "triaged", "in_progress"]).lt("due_at", dayStart.toISOString()),
      admin.from("rabbi_shailos").select("ref", { count: "exact", head: true }).eq("status", "new"),
    ]);

    // Resolve booking names (profile or SMS contact).
    const bookings = bookingsQ.data ?? [];
    const profileIds = bookings.map((b) => b.profile_id).filter(Boolean) as string[];
    const names = new Map<string, string>();
    if (profileIds.length) {
      const { data: profs } = await admin.from("rabbi_profiles").select("id, full_name").in("id", profileIds);
      for (const pr of profs ?? []) names.set(pr.id, pr.full_name);
    }

    const facts = {
      todaysTimetable: (blocksQ.data ?? []).map((b) => `${String(b.start_time).slice(0, 5)}–${String(b.end_time).slice(0, 5)} ${b.label}`),
      todaysAppointments: bookings.map((b) =>
        `${fmtTime(b.starts_at, tz)} ${b.slot_type === "call" ? "phone call" : "meeting"} with ${names.get(b.profile_id ?? "") ?? b.contact_name ?? "a community member"}${b.status === "requested" ? " (NOT yet approved)" : ""}${b.purpose ? ` — ${b.purpose}` : ""}`
      ),
      questionsDueToday: (dueQ.data ?? []).map((s) => s.is_sensitive ? `${s.ref}: a private matter (same-day)` : `${s.ref}: ${s.ai_summary ?? "a question"}`),
      questionsOverdue: overdueQ.count ?? 0,
      questionsAwaitingTriage: newQ.count ?? 0,
    };

    const system = `You write Rabbi Yechiel Emanuel's private morning briefing. Audience: the rabbi himself, on his phone. Style: warm, respectful, extremely clear, plain English with familiar frum terminology, no exclamation marks. Structure: one short greeting line, then short labelled lines (Schedule / Appointments / Questions). Mention overdue questions plainly if there are any — he wants to know. Keep the whole thing under 120 words. Never include the content of any private matter beyond what you are given. Output plain text only.`;

    const result = await callClaude({
      model: MODELS.sonnet,
      maxTokens: 400,
      system,
      messages: [{ role: "user", content: JSON.stringify(facts, null, 2) }],
    });
    const briefing = result.text.trim();

    // Store for the Today screen (channel 'app'); then SMS if configured.
    await admin.from("rabbi_messages").insert({
      direction: "out", channel: "app", body: briefing,
      related_type: "briefing", kind: "daily", status: "sent",
    });
    let smsSent = false;
    if (settings.sms_notifications_enabled && settings.rabbi_phone) {
      const r = await sendRabbiMessage(admin, {
        phone: settings.rabbi_phone, body: briefing,
        relatedType: "briefing", kind: "daily_sms",
      });
      smsSent = r.ok;
    }
    return json({ ok: true, smsSent, length: briefing.length });
  } catch (err) {
    console.error("[rabbi-daily-brief]", err);
    return json({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
