import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { preflight, json } from "../_shared/cors.ts";
import { clearSecretCache, getSecret } from "../_shared/getSecret.ts";
import { normalizePhone, sendSms } from "../_shared/textmagic.ts";
import { callOpenAI, MODELS } from "../_shared/openai.ts";

/**
 * Lets the Rov paste his own API keys in from Settings, and prove they work, without going
 * anywhere near the Supabase console.
 *
 * The keys go into the database vault, which no browser can read: this function reports only
 * whether a key is set and its last four characters, and it never echoes a value back. Only the
 * Rov himself may call it — an assistant can run the app but not hold the keys to the account.
 */
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/** The only names this function will write. Anything else is rejected outright. */
const ALLOWED = [
  "TEXTMAGIC_USERNAME",
  "TEXTMAGIC_API_KEY",
  "TEXTMAGIC_SENDER",
  "OPENAI_API_KEY",
  // Not a secret, but it lives here so the model behind the text-in assistant can be changed
  // from Settings rather than by a deploy — the quickest way to tell whether a wrong answer is
  // the model's fault or the prompt's.
  "OPENAI_SMS_MODEL",
  "RABBI_SMS_WEBHOOK_SECRET",
] as const;

async function callerIsRov(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await admin.auth.getUser(token);
  const authUserId = data?.user?.id;
  if (!authUserId) return false;
  const { data: profile } = await admin.from("rabbi_profiles")
    .select("role, is_active").eq("auth_user_id", authUserId).maybeSingle();
  return profile?.role === "rabbi" && profile?.is_active === true;
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (!(await callerIsRov(req))) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "status");

    switch (action) {
      // Which keys are set — never the values themselves.
      case "status": {
        const out: Record<string, { set: boolean; hint: string | null }> = {};
        for (const name of ALLOWED) {
          const { data } = await admin.rpc("secret_hint", { secret_name: name });
          out[name] = (data as { set: boolean; hint: string | null }) ?? { set: false, hint: null };
        }
        return json({ secrets: out });
      }

      case "save": {
        const name = String(body.name ?? "");
        if (!ALLOWED.includes(name as typeof ALLOWED[number])) return json({ error: "unknown_key" }, 400);
        const value = String(body.value ?? "").trim();
        if (!value) return json({ error: "empty" }, 400);
        const { error } = await admin.rpc("set_secret", { secret_name: name, secret_value: value });
        if (error) return json({ error: error.message }, 400);
        // The functions cache secrets for a minute; drop it so a test right after saving is
        // testing what was just typed rather than what was there before.
        clearSecretCache(name);
        return json({ ok: true, hint: value.slice(-4) });
      }

      // Prove TextMagic works by sending one real message to a number the Rov names.
      case "test_sms": {
        const to = normalizePhone(String(body.to ?? ""));
        if (!/^\+\d{8,15}$/.test(to)) return json({ error: "bad_number" }, 400);
        clearSecretCache();
        const r = await sendSms(to, "Test from Rabbi Yechiel Emanuel's assistant. If this arrived, texts are working.");
        if (!r.configured) return json({ ok: false, reason: "TextMagic username and API key are not both set." });
        if (!r.ok) return json({ ok: false, reason: r.error ?? "TextMagic refused the message." });
        return json({ ok: true, sentTo: to });
      }

      // A one-token completion: the cheapest possible proof that the key is live.
      case "test_openai": {
        clearSecretCache("OPENAI_API_KEY");
        try {
          const r = await callOpenAI({
            model: MODELS.nano, maxTokens: 16,
            system: 'Reply with the JSON object {"ok":true} and nothing else.',
            json: true,
            messages: [{ role: "user", content: "ping" }],
          });
          return json({ ok: true, model: MODELS.nano, reply: r.text.slice(0, 60) });
        } catch (err) {
          return json({ ok: false, reason: err instanceof Error ? err.message.slice(0, 200) : "failed" });
        }
      }

      /**
       * The address TextMagic must call when someone texts in. It carries the shared secret, so
       * it is only ever handed to the Rov himself — and only he can see the panel that asks for
       * it. Without this configured in the TextMagic dashboard, a text to the number reaches
       * TextMagic and stops there: nothing is delivered to the app.
       */
      case "webhook_url": {
        let secret = await getSecret("RABBI_SMS_WEBHOOK_SECRET");
        if (!secret) {
          // First time asked: mint one, so there is never a step where he has to invent it.
          secret = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
          const { error } = await admin.rpc("set_secret", { secret_name: "RABBI_SMS_WEBHOOK_SECRET", secret_value: secret });
          if (error) return json({ error: error.message }, 400);
          clearSecretCache("RABBI_SMS_WEBHOOK_SECRET");
        }
        const base = Deno.env.get("SUPABASE_URL");
        const { count } = await admin.from("rabbi_messages")
          .select("id", { count: "exact", head: true }).eq("direction", "in");
        return json({
          url: `${base}/functions/v1/rabbi-sms-inbound?secret=${secret}`,
          everReceived: (count ?? 0) > 0,
        });
      }

      default:
        return json({ error: `unknown action '${action}'` }, 400);
    }
  } catch (err) {
    console.error("[rabbi-secrets]", err);
    return json({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
