// Names the heroes in top-bar portraits the template matcher can't place.
//
// The matcher compares against each hero's base portrait, so arcana and persona cosmetics (Rubick's arcana,
// Juggernaut's Bladeform Legacy, Crystal Maiden's wolf persona...) never match, and Valve's CDN has no art for
// them to add as templates. The model recognises them; answers it isn't sure about are dropped, because a
// wrong enemy would produce wrong counter-item advice. Confident answers are saved as extra templates
// (see templates.ts), so the same cosmetic is matched locally, for free, from then on.
import Anthropic from "@anthropic-ai/sdk";
import { allHeroes } from "../data/constants.js";

/** One hero key (npc_dota_hero_*) per image, or null when unknown/unsure */
export type PortraitIdentifier = (pngs: Buffer[], opts: { model: string; apiKey: string | null }) => Promise<(string | null)[]>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Anti-Mage", "antimage", "Nature's Prophet" -> hero key */
export function heroKeyFromName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = norm(name);
  if (!n || n === "unknown") return null;
  const h = allHeroes().find((x) => norm(x.localizedName) === n || norm(x.name.replace("npc_dota_hero_", "")) === n);
  return h?.name ?? null;
}

/** Pulls {"heroes":[{"name":..., "sure":...}]} out of the reply; anything not marked sure becomes null */
export function parseIdentification(text: string, count: number): (string | null)[] {
  const out: (string | null)[] = Array(count).fill(null);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return out;
  try {
    const list = (JSON.parse(m[0]) as { heroes?: unknown }).heroes;
    if (!Array.isArray(list)) return out;
    list.slice(0, count).forEach((e, i) => {
      const entry = e as { name?: unknown; sure?: unknown };
      if (entry?.sure === true) out[i] = heroKeyFromName(entry.name);
    });
  } catch {
    /* not JSON: nothing identified */
  }
  return out;
}

export const identifyPortraits: PortraitIdentifier = async (pngs, { model, apiKey }) => {
  if (!pngs.length) return [];
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  const res = await client.messages.create({
    model,
    max_tokens: 3000,
    messages: [
      {
        role: "user",
        content: [
          ...pngs.flatMap((png, i) => [
            { type: "text" as const, text: `Portrait ${i + 1}:` },
            { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: png.toString("base64") } },
          ]),
          {
            type: "text" as const,
            text:
              `These are ${pngs.length} hero portraits cropped from the Dota 2 top bar. They may use arcana or persona cosmetics, ` +
              `may be greyed out (dead hero), and have a small rank badge in the lower left. Name the hero in each. ` +
              `Reply with JSON only: {"heroes":[{"name":"<hero name>","sure":true|false}, ...]}, one entry per portrait in order. ` +
              `Set "sure" to false unless you are confident; use "unknown" for an empty or unreadable slot.`,
          },
        ],
      },
    ],
  });
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return parseIdentification(text, pngs.length);
};
