// Outbound messaging adapter for Rabbi Emanuel's Assistant.
//
// Every send goes through sendRabbiMessage() and is logged to rabbi_messages — the log doubles
// as the notification-dedupe ledger for the rabbi-notify cron. No caller imports the TextMagic
// helper directly: adding WhatsApp later means implementing one more MessageChannel here and
// nothing else changes.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { normalizePhone, sendSms } from "./textmagic.ts";

export interface ChannelSendResult {
  ok: boolean;
  configured: boolean;
  providerId?: string;
  error?: string;
}

export interface MessageChannel {
  id: "sms" | "whatsapp";
  send(to: string, body: string): Promise<ChannelSendResult>;
}

const smsChannel: MessageChannel = {
  id: "sms",
  async send(to, body) {
    const r = await sendSms(normalizePhone(to), body);
    return { ok: r.ok, configured: r.configured, error: r.error };
  },
};

// WhatsApp via TextMagic. As of mid-2026 TextMagic's WhatsApp integration only supports
// CUSTOMER-INITIATED service conversations handled in their Messenger inbox — no API sends, no
// business-initiated messages, no bots (see textmagic.com WhatsApp integration docs). So this
// channel stays a stub that falls back to SMS; when TextMagic opens WhatsApp API sends, wire the
// endpoint here and set TEXTMAGIC_WHATSAPP_ENABLED — no caller changes needed.
const whatsappChannel: MessageChannel = {
  id: "whatsapp",
  send() {
    return Promise.resolve({ ok: false, configured: false, error: "WhatsApp send not yet available via TextMagic API" });
  },
};

const channels: Record<string, MessageChannel> = {
  sms: smsChannel,
  whatsapp: whatsappChannel,
};

export interface SendRabbiMessageOpts {
  phone: string;
  body: string;
  channel?: "sms" | "whatsapp";
  profileId?: string | null;
  conversationId?: string | null;
  relatedType?: "shailah" | "booking" | "briefing" | "otp" | "conversation" | "nudge";
  relatedId?: string | null;
  kind?: string; // 'confirmation' | 'reminder' | 'answer_ready' | 'overdue_nudge' | …
}

export async function sendRabbiMessage(
  admin: SupabaseClient,
  opts: SendRabbiMessageOpts,
): Promise<ChannelSendResult> {
  const requested = channels[opts.channel ?? "sms"] ?? smsChannel;
  let result = await requested.send(opts.phone, opts.body);
  let usedChannel = requested.id;

  // A channel that exists in the schema but has no live provider (WhatsApp today) falls back
  // to SMS rather than silently dropping the message.
  if (!result.ok && !result.configured && requested.id !== "sms") {
    result = await smsChannel.send(opts.phone, opts.body);
    usedChannel = "sms";
  }

  await admin.from("rabbi_messages").insert({
    conversation_id: opts.conversationId ?? null,
    profile_id: opts.profileId ?? null,
    direction: "out",
    channel: usedChannel,
    phone: normalizePhone(opts.phone),
    body: opts.body,
    provider_id: result.providerId ?? null,
    related_type: opts.relatedType ?? null,
    related_id: opts.relatedId ?? null,
    kind: opts.kind ?? null,
    status: result.ok ? "sent" : "failed",
    error: result.error ?? null,
  });

  if (opts.conversationId) {
    await admin.from("rabbi_conversations")
      .update({ last_outbound_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", opts.conversationId);
  }
  return result;
}

// Has a notification with this identity already been sent? (Dedupe for crons.)
export async function alreadySent(
  admin: SupabaseClient,
  relatedType: string,
  relatedId: string,
  kind: string,
): Promise<boolean> {
  const { data } = await admin
    .from("rabbi_messages")
    .select("id")
    .eq("related_type", relatedType)
    .eq("related_id", relatedId)
    .eq("kind", kind)
    .eq("status", "sent")
    .limit(1);
  return (data ?? []).length > 0;
}
