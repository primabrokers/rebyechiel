const ANTHROPIC_API_KEY = () => Deno.env.get("ANTHROPIC_API_KEY") ?? "";

export const MODELS = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
} as const;

const MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4-5": MODELS.opus,
  "claude-opus-4-6": MODELS.opus,
  "claude-opus-4-7": MODELS.opus,
  "claude-opus-4-20250514": MODELS.opus,
  "claude-sonnet-4-5": MODELS.sonnet,
  "claude-sonnet-4-20250514": MODELS.sonnet,
  "claude-sonnet-4-6-20251022": MODELS.sonnet,
  "claude-sonnet-4-6": MODELS.sonnet,
  "claude-haiku-4-5": MODELS.haiku,
  "claude-haiku-4-20250414": MODELS.haiku,
  "claude-haiku-4-3": MODELS.haiku,
  "claude-3-5-haiku-latest": MODELS.haiku,
};

export function normalizeClaudeModel(model?: string | null, fallback = MODELS.sonnet): string {
  const value = (model ?? "").trim();
  if (!value) return fallback;
  return MODEL_ALIASES[value] ?? value;
}

export function shouldOmitClaudeTemperature(model: string): boolean {
  const value = normalizeClaudeModel(model).toLowerCase();
  // Sonnet 5 (like Opus 4.7+/Fable/Mythos) rejects non-default temperature/top_p/top_k with a 400.
  return (
    value.includes("claude-opus-4") ||
    value.startsWith("claude-sonnet-5") ||
    value.startsWith("claude-fable") ||
    value.startsWith("claude-mythos")
  );
}

interface CallClaudeOpts {
  model: string;
  maxTokens: number;
  temperature?: number;
  system: string;
  messages: { role: string; content: string }[];
}

interface CallClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// Every Claude call is told the current UK date & time — AI-drafted emails were opening with
// "Good morning" in the afternoon because the model has no clock. Kept as its OWN system block
// (after the cached one) so the changing timestamp never breaks prompt caching.
export function ukNowSystemLine(): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return `Current UK date and time (Europe/London): ${fmt.format(new Date())}. ` +
    `When greeting or referring to the time of day, use this UK time — "Good morning" only before 12:00, ` +
    `"Good afternoon" 12:00–17:59, "Good evening" after 18:00. Use it for any dates you mention too.`;
}

export async function callClaude(opts: CallClaudeOpts): Promise<CallClaudeResult> {
  const model = normalizeClaudeModel(opts.model);
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens,
    // Cache the system prompt — it carries the large, reused workbench/data context, so
    // multi-turn assistants and repeated calls pay ~90% less for it on cache hits. No effect on
    // the output; prompts below the cache minimum are simply not cached (no downside).
    system: [
      { type: "text", text: opts.system, cache_control: { type: "ephemeral" } },
      { type: "text", text: ukNowSystemLine() },
    ],
    messages: opts.messages,
  };
  if (!shouldOmitClaudeTemperature(model)) {
    body.temperature = opts.temperature ?? 0.7;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const text = extractText(data);
  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

export function extractText(response: Record<string, unknown>): string {
  const content = response.content as Array<{ type: string; text?: string }>;
  if (!content) return "";
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}
