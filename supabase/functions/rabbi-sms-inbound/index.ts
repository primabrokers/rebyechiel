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
  /** One clarifying round has been asked and answered — never ask a second. */
  clarified?: boolean;
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

/**
 * Categories the assistant must never probe. A niddah or shalom bayis question is between the
 * person and the Rov, and a chinuch matter about someone's child is not something to interrogate
 * by text — take what is offered and let him ask himself, or ring.
 */
const NO_PROBE = ["niddah", "shalom_bayis", "chinuch"];

const HANDOFF_TEXT = "No problem — the Rov's assistant will call you to sort this out properly. Thank you for texting.";
const WELCOME_MENU = "This is Rabbi Yechiel Emanuel's assistant. Reply 1 to ask the Rov a question, 2 to book a phone call, 3 to request a meeting. (This service can't answer questions itself — everything goes to the Rov.)";

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
        const slots = (await expandSlots(admin, slotType, tz, 60, settings.erev_cutoff_minutes ?? 90)).slice(0, MAX_SLOTS_OFFERED);
        if (!slots.length) {
          return await reply(
            `There are no ${slotType === "call" ? "phone call" : "meeting"} times available just now. The Rov's assistant will be told you asked — or text 1 to send the Rov a question instead.`,
            { state: "handed_off", intent: slotType, turn_count: 0 },
          );
        }
        const menu = slots.map((s, i) => `${i + 1}) ${fmtSlot(s.startsAt, tz)}`).join("\n");
        return await reply(
          `These times are available:\n${menu}\nReply with the number you'd like, and a line on what it's concerning${profile ? "" : ", and your name"}.`,
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
        const missing = [
          !profile && !draft.name ? "your name" : null,
          !draft.purpose ? "a line on what it's concerning" : null,
        ].filter(Boolean);
        if (missing.length) {
          return await reply(`Thank you. Could you send ${missing.join(" and ")}?`, { state: "collecting_booking", draft });
        }
        return await reply(
          `To confirm: a ${draft.slot_type === "call" ? "phone call" : "meeting"} with the Rov at ${fmtSlot(chosen.startsAt, tz)} for ${profile?.full_name ?? draft.name}, about ${draft.purpose}. Reply YES to confirm or NO to cancel.`,
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
            const slots = (await expandSlots(admin, slot.slotType, tz, 60, settings.erev_cutoff_minutes ?? 90)).slice(0, MAX_SLOTS_OFFERED);
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

WHAT THEY WANT (decide this first, every turn):
- Anything asking to SPEAK to the Rov \u2014 "can I have a call", "can he ring me", "I need to talk to him", "can I speak to the Rov" \u2014 is intent "call". It is NOT a shailah. Do not offer to pass it on as a question.
- Anything asking to SEE him, come in, or meet is intent "meeting".
- A halachic question they want answered is intent "shailah".
- If they ask for a call AND give a question, it is "call" \u2014 they have told you how they want it dealt with.

FOR A CALL OR A MEETING:
Ask what it is concerning, in one line, before you offer times \u2014 the Rov wants to know what the call is about before he rings, and a one-line answer is enough ("my son\u2019s school", "a business matter"). Put it in "purpose". Do not press for detail: if they would rather not say, that is fine, use "would rather say on the phone" and carry on.

HOW URGENT \u2014 never ask them to pick a word:
Do NOT write "urgent, soon or standard", or offer the tier names in any form. They are labels for
the Rov\u2019s queue, not language a person uses. Work it out yourself from what they say, and if you
genuinely cannot, ask a plain question a person would ask: "Do you need this before Shabbos?",
"Is this for tonight?", "Is it needed today, or can it wait a day or two?"
Then infer urgency_slug yourself from ANY answer, however they phrase it \u2014 "asap", "tonight",
"before candle lighting", "the food is on the fire now", "no rush", "whenever he gets a chance".
Most of the time you should not need to ask at all: a pot on the fire, a fast day, anything
medical or before an oncoming Shabbos or yom tov is urgent on its face.

HARD RULES:
- You NEVER answer halachic questions, give advice, or paskin — not even a hint. Every question goes to the Rov.
- Replies must fit in one SMS: at most 300 characters, plain warm English, no emoji.
- Never invent appointment times. Only the numbered slots listed in CONTEXT may be offered.
- If the person seems distressed or the matter is clearly urgent (e.g. a niddah question, a medical situation tonight), set urgency_slug to "urgent" and reassure them the Rov will treat it as urgent.
- If you cannot tell what they want after this turn, set "confused": true.

CONVERSATION CONTEXT:
- state: ${state}; intent: ${conv.intent ?? "unknown"}
- known member: ${profile ? profile.full_name : "no — ask for a name before confirming"}
- ALREADY COLLECTED, never ask for these again: ${
      [
        draft.question ? `their question ("${String(draft.question).slice(0, 80)}")` : null,
        (profile?.full_name ?? draft.name) ? `their name (${profile?.full_name ?? draft.name})` : null,
        draft.urgency_slug ? `how urgent (${draft.urgency_slug})` : null,
        draft.category_slug ? `the category (${draft.category_slug})` : null,
      ].filter(Boolean).join("; ") || "nothing yet"
    }
- still needed: ${
      [
        !draft.question && conv.intent === "shailah" ? "their question" : null,
        !(profile?.full_name ?? draft.name) ? "their name" : null,
        !draft.purpose && (conv.intent === "call" || conv.intent === "meeting") ? "what it is concerning (one line)" : null,
      ].filter(Boolean).join("; ") || "nothing \u2014 confirm what you have"
    }
- numbered slots currently offered: ${offered}
- shailah categories (slug: name): ${(catQ.data ?? []).map((c) => `${c.slug}: ${c.name}`).join("; ")}
- urgency tiers (slug: name): ${(tierQ.data ?? []).map((t) => `${t.slug}: ${t.name}`).join("; ")}

ASKING A USEFUL FOLLOW-UP (this is the point of the service):
The Rov should be able to answer without ringing back. When someone sends a question, ask for the one or two details he would obviously need — in ONE message, plainly, never a list of forms.
 - medication on a fast: which medicine, and what it is for
 - a kashrus mix-up: was it hot, and was the pot used that day
 - Shabbos or yom tov: is it for this coming one
 - business: roughly what is at stake and whether the other side is Jewish
 - aveilus: whose, and which day of the aveilus
NEVER probe on these, whatever they say \u2014 take what is offered and go straight to confirming: ${NO_PROBE.join(", ")}. These are private, or about someone\u2019s child. If something is unclear there, say the Rov may ring rather than asking.
Set "complete": true when you have enough that the Rov could answer without ringing back, or when the category is one of the never-probe ones.

STATE MACHINE (you may only move forward along it):
idle/intent -> collecting_shailah (they want to ask a question) or collecting_booking (call/meeting)
collecting_shailah -> confirming, once you have their question, your one follow-up answered, and their name if not a known member.
collecting_booking -> confirming, once a numbered slot is chosen (and their name if needed).
confirming: restate what will be sent/booked and tell them to reply YES.

Reply with STRICT JSON only:
{"reply": "<the SMS to send>", "next_state": "<intent|collecting_shailah|collecting_booking|confirming>", "intent": "<shailah|call|meeting|null>", "updates": {"question": "...", "category_slug": "...", "urgency_slug": "...", "slot_index": <n>, "purpose": "...", "name": "..."}, "complete": false, "confused": false}
When you ask a follow-up, fold the answer back into "question" so it reads as one whole shailah for the Rov.
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
      const slots = (await expandSlots(admin, slotType, tz, 60, settings.erev_cutoff_minutes ?? 90)).slice(0, MAX_SLOTS_OFFERED);
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

    // The state machine advances on the FACTS, not on the model's opinion of them. Left to the
    // model, it asked for a name it had already been given, three turns running: it can see the
    // draft but it does not reliably act on it. So the moment we hold everything a shailah or a
    // booking needs, code moves to confirming and writes the confirmation itself.
    const who = profile?.full_name ?? newDraft.name ?? null;
    // One clarifying round, then confirm — the assistant may ask what the Rov would ask, but it
    // may not interrogate. Private and chinuch matters skip the round entirely.
    const noProbe = NO_PROBE.includes(newDraft.category_slug ?? "");
    const enoughDetail = noProbe || newDraft.clarified === true || parsed.complete === true;
    if (intent === "shailah" && newDraft.question && !enoughDetail) newDraft.clarified = true;

    const shailahReady = intent === "shailah" && Boolean(newDraft.question) && Boolean(who) && enoughDetail;
    const bookingReady = (intent === "call" || intent === "meeting")
      && Boolean(newDraft.slot_index) && Boolean(newDraft.offered_slots) && Boolean(who)
      && Boolean(newDraft.purpose);

    // Last line of defence: never send a reply that asks for something we already hold. The
    // prompt tells the model what it has and the gate below advances on facts, but a model that
    // ignores both would otherwise send "what is your question?" to someone who just sent it —
    // which is how this felt broken to real people. Rewrite the reply rather than send it.
    const asksForQuestion = /what (is |was )?(your|the) (question|shailah)|send (me )?(your|the) (question|shailah)|what.{0,12}(would you like to|do you want to) ask/i;
    const asksForName = /what (is |should )?(your|the) name|may i (have|take) your name|who (is|am i) (this|speaking)/i;
    if (newDraft.question && asksForQuestion.test(replyText)) {
      replyText = who
        ? `Thank you \u2014 I have your question. One moment while I put it to the Rov.`
        : `Thank you \u2014 I have your question. What name should I put on it?`;
    } else if (who && asksForName.test(replyText)) {
      replyText = `Thank you ${who.split(" ")[0]}. I have what I need \u2014 putting it to the Rov now.`;
    }

    let finalState: ConvState = nextState;
    if (shailahReady) {
      finalState = "confirming";
      const urgent = newDraft.urgency_slug === "urgent";
      const q = String(newDraft.question).replace(/\s+/g, " ").trim();
      replyText = `Thank you ${who!.split(" ")[0]}. Sending to the Rov: "${q.length > 140 ? q.slice(0, 137) + "\u2026" : q}"`
        + `${urgent ? " \u2014 marked urgent." : "."} Reply YES to send it, or NO to change it.`;
    } else if (bookingReady) {
      finalState = "confirming";
      const slot = newDraft.offered_slots![newDraft.slot_index! - 1];
      replyText = `To confirm: a ${newDraft.slot_type === "call" ? "phone call" : "meeting"} with the Rov at `
        + `${fmtSlot(slot.startsAt, tz)} for ${who}, about ${newDraft.purpose}. Reply YES to confirm or NO to cancel.`;
    } else if (nextState === "confirming") {
      // The model wanted to confirm without the material to confirm — stay and keep collecting.
      finalState = intent === "shailah" ? "collecting_shailah" : intent ? "collecting_booking" : "intent";
    }

    return await reply(replyText, {
      state: finalState, intent, draft: newDraft, turn_count: (conv.turn_count ?? 0) + 1,
    });
  } catch (err) {
    console.error("[rabbi-sms-inbound]", err);
    return json({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
