import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { preflight, json } from "../_shared/cors.ts";
import { callOpenAI, MODELS, parseJsonReply } from "../_shared/openai.ts";

/**
 * AI triage for incoming shailos. Suggests category + urgency + a short summary; the rabbi
 * confirms (or corrects) with one tap in the queue, which is what actually moves the shailah to
 * 'triaged' via rabbi-public's confirm_triage. Suggestions only — this function never changes
 * the category/urgency/promise the asker was given.
 *
 * Callers: rabbi-public (service key, fire-and-forget after submit) or an admin user re-running
 * triage from the queue.
 */
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function isAuthorised(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return false;
  const { data: profile } = await admin.from("rabbi_profiles")
    .select("role, is_active").eq("auth_user_id", data.user.id).maybeSingle();
  return Boolean(profile?.is_active && ["rabbi", "assistant"].includes(profile.role));
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    if (!(await isAuthorised(req))) return json({ error: "forbidden" }, 403);
    const { shailahId } = await req.json().catch(() => ({}));
    if (!shailahId) return json({ error: "shailahId required" }, 400);

    const [{ data: shailah }, { data: categories }, { data: tiers }] = await Promise.all([
      admin.from("rabbi_shailos").select("id, question, is_sensitive").eq("id", shailahId).maybeSingle(),
      admin.from("rabbi_categories").select("id, slug, name, description, default_same_day, is_sensitive").eq("is_active", true).order("sort_order"),
      admin.from("rabbi_urgency_tiers").select("id, slug, name, description, priority").eq("is_active", true).order("sort_order"),
    ]);
    if (!shailah) return json({ error: "not_found" }, 404);

    const catLines = (categories ?? []).map((c) =>
      `- ${c.slug}: ${c.name}${c.description ? ` — ${c.description}` : ""}${c.is_sensitive ? " (SENSITIVE)" : ""}${c.default_same_day ? " (always same-day)" : ""}`
    ).join("\n");
    const tierLines = (tiers ?? []).map((t) =>
      `- ${t.slug}: ${t.name}${t.description ? ` — ${t.description}` : ""}`
    ).join("\n");

    const system = `You triage halachic questions (shailos) submitted to Rabbi Yechiel Emanuel so his queue is ordered correctly. You never answer the question itself.

Categories (use the slug):
${catLines}

Urgency tiers (use the slug):
${tierLines}

Rules:
- Niddah / taharas hamishpacha questions are ALWAYS the niddah category, always sensitive, always the most urgent tier. Time-bound mitzvah questions (tonight's Shabbos, a flight today, food currently on the stove) are urgent.
- sensitive=true whenever the question involves niddah, shalom bayis, intimacy, medical or mental-health details, or anything the asker would clearly not want a third party to read. For sensitive questions the summary must be fully generic (e.g. "A taharas hamishpacha question") — no details whatsoever.
- summary: at most 12 words, plain English, for the rabbi's queue list.
- confidence: 0 to 1, how sure you are of the category.

Reply with STRICT JSON only, no prose: {"category": "<slug>", "urgency": "<slug>", "sensitive": true|false, "summary": "<string>", "confidence": <number>}`;

    const result = await callOpenAI({
      model: MODELS.nano,
      maxTokens: 300,
      system,
      json: true,
      messages: [{ role: "user", content: shailah.question.slice(0, 4000) }],
    });
    const parsed = parseJsonReply(result.text);
    if (!parsed) return json({ error: "unparseable_ai_reply", raw: result.text.slice(0, 200) }, 502);

    const category = (categories ?? []).find((c) => c.slug === parsed.category) ?? null;
    const tier = (tiers ?? []).find((t) => t.slug === parsed.urgency) ?? null;
    const sensitive = Boolean(parsed.sensitive) || Boolean(category?.is_sensitive);

    const { error } = await admin.from("rabbi_shailos").update({
      ai_suggested_category_id: category?.id ?? null,
      ai_suggested_urgency_id: tier?.id ?? null,
      ai_summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 200) : null,
      ai_confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : null,
      // Sensitivity only ever ratchets ON here — an AI miss must not expose an asker.
      is_sensitive: shailah.is_sensitive || sensitive,
      updated_at: new Date().toISOString(),
    }).eq("id", shailah.id);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, suggestion: { category: category?.slug ?? null, urgency: tier?.slug ?? null, sensitive } });
  } catch (err) {
    console.error("[rabbi-triage]", err);
    return json({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
