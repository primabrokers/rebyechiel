// Shared domain logic for Rabbi Emanuel's Assistant edge functions.
//
// rabbi-public (the app API) and rabbi-sms-inbound (the text-in bot) must create shailos and
// bookings through EXACTLY the same code paths — same promise calculation, same capacity checks,
// same confirmations — so the logic lives here rather than in either function.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { atLocalTime, computeEta, localParts } from "./rabbiEta.ts";

export interface RabbiSettings {
  timezone: string;
  daily_shailah_capacity: number;
  same_day_cutoff_hour: number;
  same_day_promise_hour: number;
  calls_auto_confirm: boolean;
  meetings_auto_confirm: boolean;
  sms_notifications_enabled: boolean;
  briefing_enabled: boolean;
  rabbi_phone: string | null;
}

export async function loadRabbiSettings(admin: SupabaseClient): Promise<RabbiSettings> {
  const { data } = await admin.from("rabbi_settings").select("*").eq("id", 1).maybeSingle();
  return (data as RabbiSettings | null) ?? {
    timezone: "Europe/London", daily_shailah_capacity: 10, same_day_cutoff_hour: 15,
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

/** yyyy-mm-dd of an instant in the Rov's timezone — how a day off is matched. */
function localDateKey(d: Date, tz: string): string {
  const p = localParts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export async function expandSlots(
  admin: SupabaseClient,
  slotType: "call" | "meeting",
  tz: string,
  limit = 60,
): Promise<SlotOut[]> {
  const now = new Date();
  const nowIso = now.toISOString();
  const horizon = new Date(Date.now() + HORIZON_DAYS * 86_400_000).toISOString();
  const [releasesQ, weeklyQ, bookingsQ, blocksQ, offQ] = await Promise.all([
    admin.from("rabbi_slot_releases").select("*")
      .eq("slot_type", slotType).eq("status", "open")
      .gt("ends_at", nowIso).lt("starts_at", horizon)
      .order("starts_at"),
    admin.from("rabbi_availability").select("*").eq("slot_type", slotType).eq("is_active", true),
    admin.from("rabbi_bookings").select("starts_at, ends_at")
      .in("status", ["requested", "confirmed"]).gt("ends_at", nowIso),
    admin.from("rabbi_timetable_blocks").select("weekday, start_time, end_time").eq("is_active", true),
    admin.from("rabbi_time_off").select("on_date").gte("on_date", localDateKey(now, tz)),
  ]);
  const bookings = (bookingsQ.data ?? []).map((b) => ({ s: Date.parse(b.starts_at), e: Date.parse(b.ends_at) }));
  const blocks = blocksQ.data ?? [];
  const daysOff = new Set((offQ.data ?? []).map((d) => String(d.on_date)));

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
    if (p.weekday === 6) continue;                             // never Shabbos
    if (daysOff.has(localDateKey(probe, tz))) continue;        // he told us he's away
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
  const [{ data: category }, { data: tier }, { count: queueAhead }] = await Promise.all([
    input.categoryId
      ? admin.from("rabbi_categories").select("id, default_same_day, is_sensitive").eq("id", input.categoryId).maybeSingle()
      : Promise.resolve({ data: null }),
    input.urgencyTierId
      ? admin.from("rabbi_urgency_tiers").select("id, promise_type, promise_hours").eq("id", input.urgencyTierId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("rabbi_shailos").select("id", { count: "exact", head: true })
      .in("status", ["new", "triaged", "in_progress"]),
  ]);

  const eta = computeEta({
    now: new Date(),
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
  const fresh = await expandSlots(admin, input.slot.slotType, settings.timezone);
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
