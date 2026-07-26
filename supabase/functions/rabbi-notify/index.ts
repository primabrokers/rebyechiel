import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { preflight, json } from "../_shared/cors.ts";
import { isCronAuthorised } from "../_shared/rabbiCronAuth.ts";
import { alreadySent, sendRabbiMessage } from "../_shared/rabbiMessaging.ts";
import { localParts } from "../_shared/rabbiEta.ts";

/**
 * Outbound notification engine — cron every 5 minutes. Each pass is idempotent: every send is
 * deduped against the rabbi_messages ledger (or a stamped column) before it goes out.
 *
 *  1. Booking reminders ~20 minutes before a confirmed call/meeting.
 *  2. "Your answer is ready" texts when a shailah flips to answered.
 *  3. Booking approved/declined texts after the rabbi acts on a request.
 *  4. An overdue-questions nudge to the rabbi (throttled to one per 4 hours).
 *  5. Stale SMS conversations time out back to idle.
 *
 * Nothing here ever includes the content of a question or answer — refs and links only.
 * Quiet hours: no community-facing sends before 08:00 or after 22:00 local, and none on Shabbos.
 */
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const APP_NAME = "Rabbi Yechiel Emanuel";

function fmtSlot(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

interface ProfileLite { id: string; full_name: string; phone: string | null }

async function profilesById(ids: string[]): Promise<Map<string, ProfileLite>> {
  const map = new Map<string, ProfileLite>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data } = await admin.from("rabbi_profiles").select("id, full_name, phone").in("id", unique);
  for (const p of data ?? []) map.set(p.id, p as ProfileLite);
  return map;
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  // verify_jwt is off for cron delivery — enforce our own auth before doing anything.
  if (!(await isCronAuthorised(req))) return json({ error: "forbidden" }, 403);
  const report: Record<string, number> = { reminders: 0, answers: 0, bookingStatus: 0, nudges: 0, timeouts: 0 };
  try {
    const { data: settings } = await admin.from("rabbi_settings").select("*").eq("id", 1).maybeSingle();
    const tz = settings?.timezone ?? "Europe/London";
    const smsOn = settings?.sms_notifications_enabled ?? true;
    const now = new Date();
    const local = localParts(now, tz);
    const isShabbos = local.weekday === 6;
    const quiet = local.hour < 8 || local.hour >= 22;
    const communitySendsAllowed = smsOn && !isShabbos && !quiet;

    // 1. Booking reminders: confirmed, starting in the next 25 minutes, not yet reminded.
    //    (Reminders ride through quiet hours — a 7:50am call still deserves its 7:30am text —
    //    but never on Shabbos, when no booking should exist anyway.)
    if (smsOn && !isShabbos) {
      const windowEnd = new Date(now.getTime() + 25 * 60_000).toISOString();
      const { data: due } = await admin.from("rabbi_bookings")
        .select("id, ref, slot_type, starts_at, profile_id, contact_name, contact_phone")
        .eq("status", "confirmed").is("reminder_sent_at", null)
        .gt("starts_at", now.toISOString()).lte("starts_at", windowEnd);
      const profs = await profilesById((due ?? []).map((b) => b.profile_id).filter(Boolean) as string[]);
      for (const b of due ?? []) {
        const prof = b.profile_id ? profs.get(b.profile_id) : undefined;
        const phone = prof?.phone ?? b.contact_phone;
        const what = b.slot_type === "call" ? "phone call with Rabbi Emanuel" : "meeting with Rabbi Emanuel";
        if (phone) {
          await sendRabbiMessage(admin, {
            phone, body: `Reminder: your ${what} is at ${fmtSlot(b.starts_at, tz)}.`,
            profileId: b.profile_id, relatedType: "booking", relatedId: b.id, kind: "reminder",
          });
        }
        if (settings?.rabbi_phone) {
          await sendRabbiMessage(admin, {
            phone: settings.rabbi_phone,
            body: `Coming up at ${fmtSlot(b.starts_at, tz)}: ${b.slot_type} with ${prof?.full_name ?? b.contact_name ?? "a community member"}.`,
            relatedType: "booking", relatedId: b.id, kind: "reminder_rabbi",
          });
        }
        await admin.from("rabbi_bookings").update({ reminder_sent_at: now.toISOString() }).eq("id", b.id);
        report.reminders++;
      }
    }

    // 2. Answer-ready notifications.
    if (communitySendsAllowed) {
      const { data: answered } = await admin.from("rabbi_shailos")
        .select("id, ref, profile_id, contact_phone, channel")
        .eq("status", "answered").not("answered_at", "is", null)
        .order("answered_at", { ascending: false }).limit(50);
      const profs = await profilesById((answered ?? []).map((s) => s.profile_id).filter(Boolean) as string[]);
      for (const s of answered ?? []) {
        if (await alreadySent(admin, "shailah", s.id, "answer_ready")) continue;
        const prof = s.profile_id ? profs.get(s.profile_id) : undefined;
        const phone = prof?.phone ?? s.contact_phone;
        if (!phone) continue;
        // SMS-channel askers have no app: the rabbi calls or texts them himself, so only nudge
        // app users here.
        const body = s.channel === "app"
          ? `The Rov has answered your question (${s.ref}). Open ${APP_NAME} to read it.`
          : `The Rov has an answer to your question (${s.ref}). He, or his assistant, will be in touch.`;
        await sendRabbiMessage(admin, {
          phone, body, profileId: s.profile_id, relatedType: "shailah", relatedId: s.id, kind: "answer_ready",
        });
        report.answers++;
      }
    }

    // 3. Booking approved / declined texts (status set by the rabbi after a request).
    if (communitySendsAllowed) {
      const { data: acted } = await admin.from("rabbi_bookings")
        .select("id, ref, slot_type, starts_at, status, decline_reason, profile_id, contact_phone")
        .in("status", ["confirmed", "declined"])
        .gt("updated_at", new Date(now.getTime() - 24 * 3_600_000).toISOString())
        .limit(50);
      const profs = await profilesById((acted ?? []).map((b) => b.profile_id).filter(Boolean) as string[]);
      for (const b of acted ?? []) {
        // A booking auto-confirmed at creation already got its confirmation from rabbi-public.
        if (await alreadySent(admin, "booking", b.id, "confirmation")) continue;
        const kind = b.status === "confirmed" ? "approved_note" : "declined_note";
        if (await alreadySent(admin, "booking", b.id, kind)) continue;
        const prof = b.profile_id ? profs.get(b.profile_id) : undefined;
        const phone = prof?.phone ?? b.contact_phone;
        if (!phone) continue;
        const what = b.slot_type === "call" ? "phone call" : "meeting";
        const body = b.status === "confirmed"
          ? `The Rov has confirmed your ${what} for ${fmtSlot(b.starts_at, tz)}. Ref ${b.ref}.`
          : `Unfortunately the Rov can't make your ${what} on ${fmtSlot(b.starts_at, tz)}${b.decline_reason ? ` — ${b.decline_reason}` : ""}. Please book another time in ${APP_NAME}.`;
        await sendRabbiMessage(admin, {
          phone, body, profileId: b.profile_id, relatedType: "booking", relatedId: b.id, kind,
        });
        report.bookingStatus++;
      }
    }

    // 4. Overdue nudge to the rabbi — at most one every 4 hours, daytime only.
    if (smsOn && settings?.rabbi_phone && !isShabbos && local.hour >= 9 && local.hour < 21) {
      const { count: overdue } = await admin.from("rabbi_shailos")
        .select("id", { count: "exact", head: true })
        .in("status", ["new", "triaged", "in_progress"]).lt("due_at", now.toISOString());
      if ((overdue ?? 0) > 0) {
        const since = new Date(now.getTime() - 4 * 3_600_000).toISOString();
        const { data: recent } = await admin.from("rabbi_messages")
          .select("id").eq("related_type", "nudge").eq("kind", "overdue").gt("created_at", since).limit(1);
        if (!(recent ?? []).length) {
          await sendRabbiMessage(admin, {
            phone: settings.rabbi_phone,
            body: `${overdue} question${overdue === 1 ? " is" : "s are"} past the promised reply time. Open ${APP_NAME} when you have a moment.`,
            relatedType: "nudge", kind: "overdue",
          });
          report.nudges++;
        }
      }
    }

    // 5. Stale SMS conversations back to idle (the bot says goodbye once).
    const { data: stale } = await admin.from("rabbi_conversations")
      .select("id, phone, channel")
      .not("state", "in", "(idle,done,handed_off)")
      .lt("expires_at", now.toISOString()).limit(20);
    for (const c of stale ?? []) {
      await admin.from("rabbi_conversations").update({
        state: "idle", intent: null, draft: {}, turn_count: 0, updated_at: now.toISOString(),
      }).eq("id", c.id);
      if (communitySendsAllowed) {
        await sendRabbiMessage(admin, {
          phone: c.phone, conversationId: c.id,
          body: `We didn't hear back, so we've closed this conversation. Text again any time and we'll start afresh.`,
          relatedType: "conversation", relatedId: c.id, kind: "timeout",
        });
      }
      report.timeouts++;
    }

    return json({ ok: true, ...report });
  } catch (err) {
    console.error("[rabbi-notify]", err);
    return json({ error: err instanceof Error ? err.message : "unknown", ...report }, 500);
  }
});
