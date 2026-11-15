// Post-game review: once the ancient falls, one AI call turns the match's numbers into a short debrief.
// Input is what the coach already tracked (final stats, you-vs-average rows, what was bought and when, the
// enemy lineup); output is a couple of things done well and a couple to work on next game.
import Anthropic from "@anthropic-ai/sdk";

export interface Review {
  matchId: string;
  hero: string; // localized name
  won: boolean;
  durationSec: number;
  kda: string;
  summary: string;
  good: string[];
  improve: string[];
  at: number;
}

export type ReviewText = Pick<Review, "summary" | "good" | "improve">;
export type ReviewCaller = (payload: unknown, opts: { model: string; apiKey: string | null; language: "ko" | "en" }) => Promise<ReviewText>;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "good", "improve"],
  properties: {
    summary: { type: "string", description: "One or two sentences: how the game went for this player" },
    good: { type: "array", description: "Up to 3 things the player did well, one short sentence each, with the number that shows it", items: { type: "string" } },
    improve: { type: "array", description: "Up to 3 concrete things to do differently next game, one short sentence each", items: { type: "string" } },
  },
} as const;

const system = (lang: "ko" | "en") => `You are a Dota 2 coach reviewing one finished match for the player.

Rules:
- ${lang === "ko" ? "Write in natural Korean (한국어); keep hero, item and ability names in English." : "Write in English."}
- Base every point on the numbers given (vs_average compares the player with the typical player of this hero at the same minute; "bad" means behind). Do not invent events you can't see in the data.
- Be specific and practical: name the stat, the item timing or the purchase, and what to do next time.
- Deaths, last hits and item timings matter more than the win or loss itself.
- No filler, no praise for its own sake. Short sentences.`;

export const callReview: ReviewCaller = async (payload, { model, apiKey, language }) => {
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  const res = await client.beta.messages.create({
    model,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: system(language),
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined to answer");
  if (res.stop_reason === "max_tokens") throw new Error("The response was cut off (max_tokens)");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const raw = JSON.parse(text) as Partial<ReviewText>;
  return {
    summary: String(raw.summary ?? ""),
    good: (raw.good ?? []).map(String).slice(0, 3),
    improve: (raw.improve ?? []).map(String).slice(0, 3),
  };
};
