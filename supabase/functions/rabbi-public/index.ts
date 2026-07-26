import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { preflight, json } from "../_shared/cors.ts";
import { computeEta } from "../_shared/rabbiEta.ts";
import { sendRabbiMessage } from "../_shared/rabbiMessaging.ts";
import { normalizePhone } from "../_shared/textmagic.ts";
import {
  createBooking, createShailah, expandSlots, fireTriage, fmtSlot, loadRabbiSettings,
} from "../_shared/rabbiCore.ts";

/**
 * Rabbi Emanuel's Assistant — authenticated app API.
 *
 * All community writes flow through here (service role) rather than direct table access, so the
 * reply-promise calculation, slot capacity checks and AI triage can never be bypassed by a
 * client. Reads that RLS already scopes safely (own shailos, own bookings, categories, tiers)
 * happen client-side in rabbi-app. The SMS bot creates records through the same
 * _shared/rabbiCore.ts paths.
 *
 * Actions: public_config, bootstrap, me, slots, book, submit_shailah, withdraw, cancel_booking,
 * confirm_triage (admin), set_booking_status (admin).
 */

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

interface Profile {
  id: string;
  auth_user_id: string;
  role: "rabbi" | "assistant" | "community";
  full_name: string;
  phone: string | null;
  affiliation: string | null;
  is_active: boolean;
}

async function getAuthUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data?.user?.id ?? null;
}

async function resolveCaller(req: Request): Promise<Profile | null | "unauthed"> {
  const authUserId = await getAuthUserId(req);
  if (!authUserId) return "unauthed";
  const { data: profile } = await admin
    .from("rabbi_profiles")
    .select("id, auth_user_id, role, full_name, phone, affiliation, is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return (profile as Profile | null) ?? null; // null = authed but no profile yet (needs bootstrap)
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // public_config needs no profile (used on the signup + ask screens).
    if (action === "public_config") {
      const [cats, tiers] = await Promise.all([
        admin.from("rabbi_categories").select("id, slug, name, description, default_same_day, is_sensitive, sort_order").eq("is_active", true).order("sort_order"),
        admin.from("rabbi_urgency_tiers").select("id, slug, name, description, sort_order").eq("is_active", true).order("sort_order"),
      ]);
      return json({ categories: cats.data ?? [], urgencyTiers: tiers.data ?? [] });
    }

    const caller = await resolveCaller(req);
    if (caller === "unauthed") return json({ error: "not_authenticated" }, 401);

    // bootstrap: create the profile right after auth signup (email+password path).
    if (action === "bootstrap") {
      if (caller) return json({ profile: caller });
      const authUserId = await getAuthUserId(req);
      if (!authUserId) return json({ error: "not_authenticated" }, 401);
      const fullName = String(body.fullName ?? "").trim();
      const affiliation = String(body.affiliation ?? "");
      if (!fullName) return json({ error: "fullName required" }, 400);
      if (!["shul_member", "beis_hatalmud", "mosdos", "other"].includes(affiliation)) {
        return json({ error: "affiliation required" }, 400);
      }
      const phone = body.phone ? normalizePhone(String(body.phone)) : null;
      const { data: profile, error } = await admin.from("rabbi_profiles").insert({
        auth_user_id: authUserId, full_name: fullName, affiliation, phone, role: "community",
      }).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ profile });
    }

    if (!caller) return json({ error: "no_profile" }, 403);
    if (!caller.is_active) return json({ error: "account_disabled" }, 403);
    const settings = await loadRabbiSettings(admin);

    switch (action) {
      case "me":
        return json({ profile: caller });

      case "slots": {
        const slotType = body.slotType === "meeting" ? "meeting" : "call";
        const slots = await expandSlots(admin, slotType, settings.timezone);
        return json({ slots });
      }

      case "book": {
        const slotType = body.slotType === "meeting" ? "meeting" : "call";
        const startsAt = String(body.startsAt ?? "");
        const releaseId = String(body.releaseId ?? "");
        if (!startsAt || !releaseId) return json({ error: "releaseId and startsAt required" }, 400);
        const slots = await expandSlots(admin, slotType, settings.timezone);
        const slot = slots.find((s) => s.releaseId === releaseId && s.startsAt === startsAt);
        if (!slot) return json({ error: "slot_taken" }, 409);

        const result = await createBooking(admin, settings, {
          profileId: caller.id, channel: "app", slot,
          purpose: body.purpose ? String(body.purpose) : null,
        });
        if (result.error || !result.booking) return json({ error: result.error ?? "booking_failed" }, result.error === "slot_taken" ? 409 : 400);

        if (settings.sms_notifications_enabled && caller.phone) {
          const when = fmtSlot(slot.startsAt, settings.timezone);
          const text = result.autoConfirmed
            ? `Your ${slotType === "call" ? "phone call" : "meeting"} with Rabbi Emanuel is booked for ${when}. Ref ${result.booking.ref}.`
            : `Your meeting request for ${when} has been sent to the Rov. We'll text you as soon as he confirms. Ref ${result.booking.ref}.`;
          await sendRabbiMessage(admin, {
            phone: caller.phone, body: text, profileId: caller.id,
            relatedType: "booking", relatedId: result.booking.id, kind: "confirmation",
          });
        }
        return json({ booking: result.booking });
      }

      case "submit_shailah": {
        const question = String(body.question ?? "").trim();
        if (!question) return json({ error: "question required" }, 400);
        const result = await createShailah(admin, settings, {
          profileId: caller.id,
          channel: "app",
          categoryId: body.categoryId ? String(body.categoryId) : null,
          urgencyTierId: body.urgencyTierId ? String(body.urgencyTierId) : null,
          question,
        });
        if (result.error || !result.shailah) return json({ error: result.error ?? "submit_failed" }, 400);
        fireTriage(result.shailah.id);
        return json({ shailah: result.shailah });
      }

      case "withdraw": {
        const id = String(body.shailahId ?? "");
        const { data: row } = await admin.from("rabbi_shailos").select("id, profile_id, status").eq("id", id).maybeSingle();
        if (!row || row.profile_id !== caller.id) return json({ error: "not_found" }, 404);
        if (!["new", "triaged", "in_progress"].includes(row.status)) return json({ error: "not_withdrawable" }, 400);
        await admin.from("rabbi_shailos").update({ status: "withdrawn", updated_at: new Date().toISOString() }).eq("id", id);
        return json({ ok: true });
      }

      case "cancel_booking": {
        const id = String(body.bookingId ?? "");
        const { data: row } = await admin.from("rabbi_bookings").select("id, profile_id, status").eq("id", id).maybeSingle();
        if (!row || row.profile_id !== caller.id) return json({ error: "not_found" }, 404);
        if (!["requested", "confirmed"].includes(row.status)) return json({ error: "not_cancellable" }, 400);
        await admin.from("rabbi_bookings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id);
        return json({ ok: true });
      }

      // -- Admin actions ----------------------------------------------------
      case "confirm_triage": {
        if (!["rabbi", "assistant"].includes(caller.role)) return json({ error: "forbidden" }, 403);
        const id = String(body.shailahId ?? "");
        const { data: row } = await admin.from("rabbi_shailos")
          .select("id, is_sensitive, created_at, status").eq("id", id).maybeSingle();
        if (!row) return json({ error: "not_found" }, 404);
        if (caller.role === "assistant" && row.is_sensitive) return json({ error: "forbidden" }, 403);

        const categoryId = body.categoryId ? String(body.categoryId) : null;
        const urgencyTierId = body.urgencyTierId ? String(body.urgencyTierId) : null;
        const [{ data: category }, { data: tier }, { count: queueAhead }] = await Promise.all([
          categoryId ? admin.from("rabbi_categories").select("id, default_same_day, is_sensitive").eq("id", categoryId).maybeSingle() : Promise.resolve({ data: null }),
          urgencyTierId ? admin.from("rabbi_urgency_tiers").select("id, promise_type, promise_hours").eq("id", urgencyTierId).maybeSingle() : Promise.resolve({ data: null }),
          admin.from("rabbi_shailos").select("id", { count: "exact", head: true }).in("status", ["new", "triaged", "in_progress"]),
        ]);
        // Recompute from the ORIGINAL submission time so re-triage never quietly extends a promise.
        const eta = computeEta({
          now: new Date(row.created_at),
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
        const { error } = await admin.from("rabbi_shailos").update({
          category_id: categoryId,
          urgency_tier_id: urgencyTierId,
          is_sensitive: row.is_sensitive || Boolean(category?.is_sensitive),
          due_at: eta.dueAt.toISOString(),
          status: row.status === "new" ? "triaged" : row.status,
          triage_confirmed_at: new Date().toISOString(),
          triage_confirmed_by: caller.id,
          updated_at: new Date().toISOString(),
        }).eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, dueAt: eta.dueAt.toISOString() });
      }

      case "set_booking_status": {
        if (!["rabbi", "assistant"].includes(caller.role)) return json({ error: "forbidden" }, 403);
        const id = String(body.bookingId ?? "");
        const status = String(body.status ?? "");
        if (!["confirmed", "declined", "completed", "cancelled"].includes(status)) return json({ error: "bad_status" }, 400);
        const { error } = await admin.from("rabbi_bookings").update({
          status,
          decline_reason: status === "declined" ? (body.reason ? String(body.reason).slice(0, 300) : null) : null,
          updated_at: new Date().toISOString(),
        }).eq("id", id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true }); // the notify cron texts the member about the change
      }

      default:
        return json({ error: `unknown action '${action}'` }, 400);
    }
  } catch (err) {
    console.error("[rabbi-public]", err);
    return json({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
