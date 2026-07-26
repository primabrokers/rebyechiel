import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { preflight, json } from "../_shared/cors.ts";
import { computeSha256 } from "../_shared/sha256.ts";
import { normalizePhone, sendSms } from "../_shared/textmagic.ts";

/**
 * Rabbi app phone login — step 1 (ANON). Text a one-time code to the given mobile.
 *
 * Unlike the client portal (staff-verified numbers only), community members self-register, so
 * signup mode sends a code to any plausible mobile. Login mode only confirms whether a code was
 * sent generically, never whether the number is registered (anti-enumeration, mirroring
 * portal-sms-request). Rate limited per phone to stop SMS-pump abuse.
 */
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CODE_LEN = 6;
const TTL_SECONDS = 300;
const MAX_CODES_PER_WINDOW = 3;
const WINDOW_MINUTES = 15;

function genCode(len: number): string {
  const buf = crypto.getRandomValues(new Uint32Array(1))[0];
  return (buf % 10 ** len).toString().padStart(len, "0");
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const { phone, mode } = await req.json().catch(() => ({}));
    if (!phone || typeof phone !== "string") return json({ error: "phone required" }, 400);
    const dest = normalizePhone(phone);
    if (!/^\+\d{10,15}$/.test(dest)) return json({ error: "invalid_phone" }, 400);

    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
    const { count } = await admin.from("rabbi_otp_codes")
      .select("id", { count: "exact", head: true })
      .eq("phone", dest).gt("created_at", windowStart);
    if ((count ?? 0) >= MAX_CODES_PER_WINDOW) return json({ error: "too_many_requests" }, 429);

    const { data: profile } = await admin.from("rabbi_profiles")
      .select("id").eq("phone", dest).eq("is_active", true).maybeSingle();

    // Login mode with an unknown number: pretend success (never reveal registration state).
    if (mode !== "signup" && !profile) return json({ ok: true, sent: true, registered: false });

    const code = genCode(CODE_LEN);
    const salt = crypto.randomUUID();
    const codeHash = await computeSha256(`${code}:${salt}`);
    await admin.from("rabbi_otp_codes").update({ consumed_at: new Date().toISOString() })
      .eq("phone", dest).is("consumed_at", null);
    await admin.from("rabbi_otp_codes").insert({
      phone: dest, code_hash: codeHash, salt,
      expires_at: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
    });

    const sms = await sendSms(dest, `Your code for Rabbi Emanuel's Assistant is ${code}. It expires in ${Math.round(TTL_SECONDS / 60)} minutes.`);
    return json({ ok: true, sent: sms.ok, configured: sms.configured, registered: Boolean(profile), error: sms.error ?? null });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
