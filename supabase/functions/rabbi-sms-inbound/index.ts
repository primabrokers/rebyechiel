import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { json } from "../_shared/cors.ts";
import { getSecret } from "../_shared/getSecret.ts";
import { callOpenAI, MODELS, parseJsonReply } from "../_shared/openai.ts";
import { normalizePhone } from "../_shared/textmagic.ts";
import { sendRabbiMessage } from "../_shared/rabbiMessaging.ts";
import {
  createBooking, createShailah, expandSlots, fireTriage, fmtSlot, loadRabbiSettings,
  type SlotOut,
} from "../_shared/rabbiCore.ts";

/**
 * Inbound SMS webhook — the text-in assistant for people without smartphones. TextMagic posts
 * each incoming message here (configure the webhook URL in the TextMagic admin as
 * .../functions/v1/rabbi-sms-inbound?secret=<RABBI_SMS_WEBHOOK_SECRET>; the function is
 * verify_jwt=false, so the secret is the only gate — requests without it are rejected).
 *
 * Design: a DETERMINISTIC state machine owns the conversation; the model only interprets the
 * caller's words and drafts the next reply. The model proposes {reply, next_state, updates};
 * code validates every transition and every field, and only code writes shailos/bookings —
 * through the same _shared/rabbiCore.ts paths as the app. The model is instructed to never
 * answer halacha; after two confused turns the conversation is handed off to a human.
 */
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const STATES = ["idle", "intent", "collecting_shailah", "collecting_booking", "confirming", "done", "handed_off"] as const;
type ConvState = typeof STATES[number];
const CONVERSATION_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_SLOTS_OFFERED = 3;

interface Draft {
  // shailah fields
  question?: string;
  category_slug?: string;
  urgency_slug?: string;
  // booking fields
  slot_type?: "call" | "meeting";
  slot_index?: number; // 1-based index into offered_slots
  purpose?: string;
  // shared
  name?: string;
  confused_turns?: number;
  offered_slots?: SlotOut[];
}

// TextMagic posts JSON or form-encoded depending on configuration; accept both.
async function parseInbound(req: Request): Promise<{ from: string; text: string } | null> {
  const ct = req.headers.get("content-type") ?? "";
  // deno-lint-ignore no-explicit-any
  let payload: Record<string, any> = {};
  if (ct.includes("application/json")) {
    payload = await req.json().catch(() => ({}));
  } else {
    const form = await req.formData().catch(() => null);
    if (form) for (const [k, v] of form.entries()) payload[k] = String(v);
  }
  const from = String(payload.sender ?? payload.from ?? payload.phone ?? "");
  const text = String(payload.text ?? payload.body ?? payload.message ?? "").trim();
  if (!from || !text) return null;
  return { from: normalizePhone(from), text };
}

const HANDOFF_TEXT = "No problem — the Rov's assistant will call you to sort this out properly. Thank you for texting.";
const WELCOME_MENU = "This is Rabbi Emanuel's assistant. Reply 1 to ask the Rov a question, 2 to book a phone call, 3 to request a meeting. (This service can't answer questions itself — everything goes to the Rov.)";

Deno.serve(async (req: Request) => {
  try {
    // Webhook auth: shared secret in the query string (TextMagic can't sign requests).
    const secret = await getSecret("RABBI_SMS_WEBHOOK_SECRET");
    const given = new URL(req.url).searchParams.get("secret");
    if (!secret || given !== secret) return json({ error: "forbidden" }, 403);

    const inbound = await parseInbound(req);
    if (!inbound) return json({ ok: true, ignored: "no sender/text" });
    const { from, text } = inbound;

    const settings = await loadRabbiSettings(admin);
    const tz = settings.timezone;

    // Known member? (Optional — SMS works fine for strangers too.)
    const { data: profile } = await admin.from("rabbi_profiles")
      .select("id, full_name, phone").eq("phone", from).eq("is_active", true).maybeSingle();

    // Active conversation or a fresh one.
    const { data: existing } = await admin.from("rabbi_conversations")
      .select("*").eq("phone", from).neq("state", "done")
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    let conv = existing;
    if (!conv) {
      const { data: created, error } = await admin.from("rabbi_conversations").insert({
        phone: from, profile_id: profile?.id ?? null, channel: "sms",
        state: "idle", draft: {},
        expires_at: new Date(Date.now() + CONVERSATION_TTL_MS).toISOString(),
      }).select().single();
      if (error || !created) return json({ error: error?.message ?? "conv_failed" }, 500);
      conv = created;
    }

    await admin.from("rabbi_messages").insert({
      conversation_id: conv.id, profile_id: profile?.id ?? null, direction: "in",
      channel: "sms", phone: from, body: text, related_type: "conversation",
      related_id: conv.id, status: "received",
    });

    const reply = async (body: string, patch: Partial<{ state: ConvState; intent: string | null; draft: Draft; turn_count: number }> = {}) => {
      await admin.from("rabbi_conversations").update({
        ...("state" in patch ? { state: patch.state } : {}),
        ...("intent" in patch ? { intent: patch.intent } : {}),
        ...(patch.draft !== undefined ? { draft: patch.draft } : {}),
        ...(patch.turn_count !== undefined ? { turn_count: patch.turn_count } : {}),
        profile_id: profile?.id ?? conv.profile_id ?? null,
        last_inbound_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + CONVERSATION_TTL_MS).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", conv.id);
      await sendRabbiMessage(admin, {
        phone: from, body, conversationId: conv.id, profileId: profile?.id ?? null,
        relatedType: "conversation", relatedId: conv.id, kind: "bot_reply",
      });
      return json({ ok: true });
    };

    // ---- Deterministic shortcuts before any AI ------------------------------
    const lower = text.toLowerCase();
    if (["stop", "unsubscribe"].includes(lower)) {
      await admin.from("rabbi_conversations").update({ state: "done", updated_at: new Date().toISOString() }).eq("id", conv.id);
      return json({ ok: true }); // no reply to a STOP
    }
    if (conv.state === "handed_off") {
      return json({ ok: true }); // a human owns this thread now; stay silent
    }

    const draft: Draft = (conv.draft ?? {}) as Draft;
    let state = conv.state as ConvState;

    // Menu shortcuts work from idle/intent without AI (cheap, predictable for non-techy users).
    if (state === "idle" || state === "intent") {
      if (lower === "1") {
        return await reply(
          "Of course. Please text your question for the Rov in one message — as much detail as you can. It goes only to him.",
          { state: "collecting_shailah", intent: "shailah", draft: {}, turn_count: 0 },
        );
      }
      if (lower === "2" || lower === "3") {
        const slotType = lower === "2" ? "call" : "meeting";
        const slots = (await expandSlots(admin, slotType, tz)).slice(0, MAX_SLOTS_OFFERED);
        if (!slots.length) {
          return await reply(
            `There are no ${slotType === "call" ? "phone call" : "meeting"} times available just now. The Rov's assistant will be told you asked — or text 1 to send the Rov a question instead.`,
            { state: "handed_off", intent: slotType, turn_count: 0 },
          );
        }
        const menu = slots.map((s, i) => `${i + 1}) ${fmtSlot(s.startsAt, tz)}`).join("\n");
        return await reply(
          `These times are available:\n${menu}\nReply with the number you'd like${profile ? "" : ", and please include your name"}.`,
          { state: "collecting_booking", intent: slotType, draft: { slot_type: slotType, offered_slots: slots }, turn_count: 0 },
        );
      }
      if (state === "idle") {
        // First contact: show the menu unless the message already looks like a full question —
        // let the AI route that case below.
        if (text.length < 20) {
          return await reply(WELCOME_MENU, { state: "intent", intent: null, draft: {}, turn_count: 0 });
        }
      }
    }

    // Slot-number shortcut inside a booking conversation.
    if (state === "collecting_booking" && /^[1-9]$/.test(lower) && draft.offered_slots?.length) {
      const idx = Number(lower);
      if (idx >= 1 && idx <= draft.offered_slots.length) {
        draft.slot_index = idx;
        const chosen = draft.offered_slots[idx - 1];
        if (!profile && !draft.name) {
          return await reply("Thank you. And what name should we put down?", { state: "collecting_booking", draft });
        }
        return await reply(
          `To confirm: a ${draft.slot_type === "call" ? "phone call" : "meeting"} with the Rov at ${fmtSlot(chosen.startsAt, tz)} for ${profile?.full_name ?? draft.name}. Reply YES to confirm or NO to cancel.`,
          { state: "confirming", draft },
        );
      }
    }

    // Confirmation handling — deterministic; the commit never depends on the model.
    if (state === "confirming") {
      if (/^(yes|y|yes please|ok|confirm)\b/i.test(lower)) {
        if (conv.intent === "shailah" && draft.question) {
          const [{ data: cat }, { data: tier }] = await Promise.all([
            draft.category_slug
              ? admin.from("rabbi_categories").select("id").eq("slug", draft.category_slug).maybeSingle()
              : Promise.resolve({ data: null }),
            draft.urgency_slug
              ? admin.from("rabbi_urgency_tiers").select("id").eq("slug", draft.urgency_slug).maybeSingle()
              : Promise.resolve({ data: null }),
          ]);
          const result = await createShailah(admin, settings, {
            profileId: profile?.id ?? null,
            contactName: profile?.full_name ?? draft.name ?? null,
            contactPhone: from,
            channel: "sms",
            categoryId: cat?.id ?? null,
            urgencyTierId: tier?.id ?? null,
            question: draft.question,
          });
          if (result.error || !result.shailah) {
            return await reply("Something went wrong saving your question. Please try again shortly.", {});
          }
          fireTriage(result.shailah.id);
          return await reply(
            `Your question has gone to the Rov (ref ${result.shailah.ref}). ${result.shailah.expected_reply_text} We'll text you when there's an answer.`,
            { state: "done", draft: {} },
          );
        }
        if ((conv.intent === "call" || conv.intent === "meeting") && draft.slot_index && draft.offered_slots) {
          const slot = draft.offered_slots[draft.slot_index - 1];
          const result = await createBooking(admin, settings, {
            profileId: profile?.id ?? null,
            contactName: profile?.full_name ?? draft.name ?? null,
            contactPhone: from,
            channel: "sms",
            slot,
            purpose: draft.purpose ?? null,
          });
          if (result.error === "slot_taken") {
            const slots = (await expandSlots(admin, slot.slotType, tz)).slice(0, MAX_SLOTS_OFFERED);
            if (!slots.length) return await reply("Sorry — that time has just been taken and no others are open. The Rov's assistant will call you.", { state: "handed_off" });
            const menu = slots.map((s, i) => `${i + 1}) ${fmtSlot(s.startsAt, tz)}`).join("\n");
            return await reply(`Sorry — that time has just been taken. These are still free:\n${menu}\nReply with the number you'd like.`, {
              state: "collecting_booking", draft: { ...draft, slot_index: undefined, offered_slots: slots },
            });
          }
          if (result.error || !result.booking) {
            return await reply("Something went wrong making the booking. Please try again shortly.", {});
          }
          return await reply(
            result.autoConfirmed
              ? `Booked: ${fmtSlot(slot.startsAt, tz)} (ref ${result.booking.ref}). The Rov will ${slot.slotType === "call" ? "call you" : "see you"} then.`
              : `Your request for ${fmtSlot(slot.startsAt, tz)} has gone to the Rov (ref ${result.booking.ref}). We'll text you as soon as he confirms.`,
            { state: "done", draft: {} },
          );
        }
        return await reply(WELCOME_MENU, { state: "intent", draft: {}, turn_count: 0 });
      }
      if (/^(no|n|cancel)\b/i.test(lower)) {
        return await reply("Cancelled — nothing has been sent. " + WELCOME_MENU, { state: "intent", intent: null, draft: {}, turn_count: 0 });
      }
      // Anything else in confirming falls through to the AI to interpret.
    }

    // ---- AI turn: interpret, collect, draft the next SMS --------------------
    const catQ = await admin.from("rabbi_categories").select("slug, name, default_same_day").eq("is_active", true).order("sort_order");
    const tierQ = await admin.from("rabbi_urgency_tiers").select("slug, name").eq("is_active", true).order("sort_order");
    const offered = draft.offered_slots?.map((s, i) => `${i + 1}) ${fmtSlot(s.startsAt, tz)}`).join("; ") ?? "none";

    const system = `You are the SMS assistant for Rabbi Yechiel Emanuel. You help people (often without smartphones) do exactly three things by text: (1) send the Rov a halachic question (a shailah), (2) book a phone call, (3) request a face-to-face meeting.

HARD RULES:
- You NEVER answer halachic questions, give advice, or paskin — not even a hint. Every question goes to the Rov.
- Replies must fit in one SMS: at most 300 characters, plain warm English, no emoji.
- Never invent appointment times. Only the numbered slots listed in CONTEXT may be offered.
- If the person seems distressed or the matter is clearly urgent (e.g. a niddah question, a medical situation tonight), set urgency_slug to "urgent" and reassure them the Rov will treat it as urgent.
- If you cannot tell what they want after this turn, set "confused": true.

CONVERSATION CONTEXT:
- state: ${state}; intent: ${conv.intent ?? "unknown"}
- known member: ${profile ? profile.full_name : "no — ask for a name before confirming"}
- draft so far: ${JSON.stringify({ ...draft, offered_slots: undefined })}
- numbered slots currently offered: ${offered}
- shailah categories (slug: name): ${(catQ.data ?? []).map((c) => `${c.slug}: ${c.name}`).join("; ")}
- urgency tiers (slug: name): ${(tierQ.data ?? []).map((t) => `${t.slug}: ${t.name}`).join("; ")}

STATE MACHINE (you may only move forward along it):
idle/intent -> collecting_shailah (they want to ask a question) or collecting_booking (call/meeting)
collecting_shailah -> confirming, once you have their question (and their name if not a known member). When they give the question, ask ONE follow-up at most: "How urgent is this?" unless already clear.
collecting_booking -> confirming, once a numbered slot is chosen (and their name if needed).
confirming: restate what will be sent/booked and tell them to reply YES.

Reply with STRICT JSON only:
{"reply": "<the SMS to send>", "next_state": "<intent|collecting_shailah|collecting_booking|confirming>", "intent": "<shailah|call|meeting|null>", "updates": {"question": "...", "category_slug": "...", "urgency_slug": "...", "slot_index": <n>, "purpose": "...", "name": "..."}, "confused": false}
Only include updates fields you learned THIS turn. slot_index must reference the numbered slots in CONTEXT.`;

    const ai = await callOpenAI({
      model: MODELS.mini,
      maxTokens: 500,
      system,
      json: true,
      messages: [{ role: "user", content: text.slice(0, 1500) }],
    });
    const parsed = parseJsonReply(ai.text);

    if (!parsed || typeof parsed.reply !== "string") {
      return await reply(WELCOME_MENU, { state: "intent", turn_count: (conv.turn_count ?? 0) + 1 });
    }

    // Confusion counter → human handoff after two lost turns.
    const confused = Boolean(parsed.confused);
    const confusedTurns = confused ? (draft.confused_turns ?? 0) + 1 : 0;
    if (confusedTurns >= 2) {
      return await reply(HANDOFF_TEXT, { state: "handed_off", draft: { ...draft, confused_turns: confusedTurns } });
    }

    // Validate the proposed transition; anything illegal stays put.
    const proposed = String(parsed.next_state ?? state) as ConvState;
    const allowed: Record<string, ConvState[]> = {
      idle: ["intent", "collecting_shailah", "collecting_booking"],
      intent: ["intent", "collecting_shailah", "collecting_booking"],
      collecting_shailah: ["collecting_shailah", "confirming"],
      collecting_booking: ["collecting_booking", "confirming"],
      confirming: ["confirming", "collecting_shailah", "collecting_booking"],
    };
    const nextState = (allowed[state] ?? []).includes(proposed) ? proposed : state === "idle" ? "intent" : state;

    // Merge validated updates.
    const updates = (parsed.updates ?? {}) as Record<string, unknown>;
    const catSlugs = new Set((catQ.data ?? []).map((c) => c.slug));
    const tierSlugs = new Set((tierQ.data ?? []).map((t) => t.slug));
    const newDraft: Draft = { ...draft, confused_turns: confusedTurns };
    if (typeof updates.question === "string" && updates.question.trim()) newDraft.question = updates.question.trim().slice(0, 3000);
    if (typeof updates.category_slug === "string" && catSlugs.has(updates.category_slug)) newDraft.category_slug = updates.category_slug;
    if (typeof updates.urgency_slug === "string" && tierSlugs.has(updates.urgency_slug)) newDraft.urgency_slug = updates.urgency_slug;
    if (typeof updates.name === "string" && updates.name.trim()) newDraft.name = updates.name.trim().slice(0, 120);
    if (typeof updates.purpose === "string" && updates.purpose.trim()) newDraft.purpose = updates.purpose.trim().slice(0, 300);
    if (typeof updates.slot_index === "number" && draft.offered_slots &&
        updates.slot_index >= 1 && updates.slot_index <= draft.offered_slots.length) {
      newDraft.slot_index = updates.slot_index;
    }

    // Intent moving into a booking state needs slots fetched by CODE, not the model.
    let intent = conv.intent as string | null;
    if (typeof parsed.intent === "string" && ["shailah", "call", "meeting"].includes(parsed.intent)) intent = parsed.intent;
    let replyText = String(parsed.reply).slice(0, 480);
    if (nextState === "collecting_booking" && !newDraft.offered_slots?.length) {
      const slotType = intent === "meeting" ? "meeting" : "call";
      const slots = (await expandSlots(admin, slotType, tz)).slice(0, MAX_SLOTS_OFFERED);
      if (!slots.length) {
        return await reply(
          `There are no ${slotType === "call" ? "phone call" : "meeting"} times available just now. The Rov's assistant will be told you asked.`,
          { state: "handed_off", intent, draft: newDraft },
        );
      }
      newDraft.slot_type = slotType;
      newDraft.offered_slots = slots;
      const menu = slots.map((s, i) => `${i + 1}) ${fmtSlot(s.startsAt, tz)}`).join("\n");
      replyText = `These times are available:\n${menu}\nReply with the number you'd like${profile || newDraft.name ? "" : ", and please include your name"}.`;
    }

    // Guard: never enter confirming without the material to confirm.
    let finalState: ConvState = nextState;
    if (nextState === "confirming") {
      const shailahReady = intent === "shailah" && Boolean(newDraft.question) && Boolean(profile || newDraft.name);
      const bookingReady = (intent === "call" || intent === "meeting") && Boolean(newDraft.slot_index) && Boolean(profile || newDraft.name);
      if (!shailahReady && !bookingReady) finalState = intent === "shailah" ? "collecting_shailah" : intent ? "collecting_booking" : "intent";
    }

    return await reply(replyText, {
      state: finalState, intent, draft: newDraft, turn_count: (conv.turn_count ?? 0) + 1,
    });
  } catch (err) {
    console.error("[rabbi-sms-inbound]", err);
    return json({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
