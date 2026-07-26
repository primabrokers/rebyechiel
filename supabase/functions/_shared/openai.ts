// The single AI provider for this app. Everything — shailah triage, the SMS assistant, the
// morning briefing and voice-note transcription — runs on OpenAI, so there is one account, one
// key and one bill to keep an eye on.
//
// Model choice (prices per 1M tokens, July 2026):
//   gpt-5.4-nano  $0.20 in / $1.25 out — built for classification and extraction. Triage.
//   gpt-5.4-mini  $0.75 in / $4.50 out — better instruction-following. SMS bot, briefing.
// Check https://openai.com/api/pricing/ before changing these.

import { getSecret } from "./getSecret.ts";

export const MODELS = {
  /** Classification and extraction: shailah triage. */
  nano: "gpt-5.4-nano",
  /** Conversation and prose: the SMS assistant and the morning briefing. */
  mini: "gpt-5.4-mini",
} as const;

export interface CallOpenAIOpts {
  model: string;
  maxTokens: number;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** Ask for a strict JSON object back. The prompt must mention JSON (OpenAI enforces this). */
  json?: boolean;
}

export interface CallOpenAIResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// Every call is told the current UK date and time — the model has no clock, and without this the
// briefing wishes the Rov good morning in the afternoon and misdates "tomorrow evening".
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

export async function callOpenAI(opts: CallOpenAIOpts): Promise<CallOpenAIResult> {
  const apiKey = await getSecret("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const body: Record<string, unknown> = {
    model: opts.model,
    max_completion_tokens: opts.maxTokens,
    messages: [
      { role: "system", content: `${opts.system}\n\n${ukNowSystemLine()}` },
      ...opts.messages,
    ],
  };
  // JSON mode guarantees parseable output, so no scraping a JSON blob out of prose.
  if (opts.json) body.response_format = { type: "json_object" };
  // Temperature is deliberately left at the default — the GPT-5 family rejects non-default
  // sampling parameters on several tiers, and none of these tasks want randomness anyway.

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errBody.slice(0, 400)}`);
  }

  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

/**
 * Parse a model reply that should be a JSON object. With `json: true` the reply is already clean;
 * this still tolerates a stray code fence or leading prose in case a model ignores the format.
 */
export function parseJsonReply(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}
