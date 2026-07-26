import { getSecret } from "./getSecret.ts";

// TextMagic needs a full international number. UK: 07… → +447…, 0044… → +44…, 44… → +44…,
// and pass through anything already in +E.164.
export function normalizePhone(raw: string): string {
  const p = raw.replace(/[\s()\-.]/g, "");
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return "+" + p.slice(2);
  if (p.startsWith("0")) return "+44" + p.slice(1);
  if (p.startsWith("44")) return "+" + p;
  return p;
}

export interface SmsResult {
  ok: boolean;
  configured: boolean;
  error?: string;
}

export async function sendSms(phone: string, text: string): Promise<SmsResult> {
  const username = await getSecret("TEXTMAGIC_USERNAME");
  const apiKey = await getSecret("TEXTMAGIC_API_KEY");
  if (!username || !apiKey) return { ok: false, configured: false };
  const sender = await getSecret("TEXTMAGIC_SENDER");
  const params = new URLSearchParams({ text, phones: phone });
  // TextMagic wants `from` as a bare number ("447418342580"), not E.164 — with the plus it is
  // read as an alphanumeric sender ID and rejected as "not registered under your account", even
  // when the number genuinely is yours. Alphanumeric sender IDs pass through untouched.
  if (sender) params.set("from", /^\+\d+$/.test(sender.trim()) ? sender.trim().slice(1) : sender.trim());
  const res = await fetch("https://rest.textmagic.com/api/v2/messages", {
    method: "POST",
    headers: {
      "X-TM-Username": username,
      "X-TM-Key": apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const body = await res.text();
  console.log(`[sendSms] TextMagic status=${res.status} from=${sender ?? "(default)"} phones=${phone} body=${body.slice(0, 200)}`);
  if (!res.ok) return { ok: false, configured: true, error: `TextMagic ${res.status}: ${body.slice(0, 180)}` };
  return { ok: true, configured: true };
}
