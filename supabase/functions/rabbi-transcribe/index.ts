import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { preflight, json } from "../_shared/cors.ts";
import { getSecret } from "../_shared/getSecret.ts";

/**
 * Voice-note transcription for the Rov's answers. He records a voice note in the answer screen,
 * this returns the text, and he edits/sends it — typing is the part he hates, not talking.
 *
 * Model: gpt-4o-mini-transcribe (~$0.003/min — a 2-minute answer costs about half a penny).
 *
 * The Rov and nobody else. Half a penny a time is nothing for the handful of answers he dictates
 * in a day; the same button in front of a whole kehillah is a bill with no ceiling on it. The gate
 * is here rather than in the screen, because a hidden button is not a gate.
 */
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // ~15 MB ≈ a very long voice note

async function callerIsRov(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return false;
  const { data: profile } = await admin.from("rabbi_profiles")
    .select("role, is_active").eq("auth_user_id", data.user.id).maybeSingle();
  return profile?.role === "rabbi" && profile?.is_active === true;
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (!(await callerIsRov(req))) return json({ error: "forbidden" }, 403);
    const apiKey = await getSecret("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "transcription_not_configured" }, 503);

    const { audioBase64, mimeType } = await req.json().catch(() => ({}));
    if (!audioBase64 || typeof audioBase64 !== "string") return json({ error: "audioBase64 required" }, 400);

    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_AUDIO_BYTES) return json({ error: "audio_too_large" }, 413);

    const mt = typeof mimeType === "string" && mimeType ? mimeType : "audio/webm";
    const ext = mt.includes("mp4") || mt.includes("m4a") ? "m4a"
      : mt.includes("ogg") ? "ogg" : mt.includes("mpeg") || mt.includes("mp3") ? "mp3" : "webm";

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mt }), `voice-note.${ext}`);
    form.append("model", "gpt-4o-mini-transcribe");
    // The Rov answers in English peppered with loshon kodesh/Yiddish; a hint keeps names intact.
    form.append("prompt", "A rabbi dictating a halachic answer in English with Hebrew and Yiddish terms (e.g. treif, kashered, b'dieved, muttar, assur, chosson, shiur).");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error("[rabbi-transcribe] OpenAI", res.status, errBody.slice(0, 300));
      return json({ error: `transcription_failed_${res.status}` }, 502);
    }
    const data = await res.json();
    return json({ text: String(data.text ?? "").trim() });
  } catch (err) {
    console.error("[rabbi-transcribe]", err);
    return json({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
