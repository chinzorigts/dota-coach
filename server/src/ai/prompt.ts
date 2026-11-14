import type { GameSnapshot } from "../gsi/normalize.js";
import { getAbility, getHero, getItem } from "../data/constants.js";
import type { CoachReport } from "../engine/types.js";

export const ADVICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "danger", "next_items", "skill_priority", "tips"],
  properties: {
    summary: { type: "string", description: "One or two sentence summary of the current situation" },
    danger: { type: "string", enum: ["low", "medium", "high"] },
    next_items: {
      type: "array",
      description: "Items to buy next, in order. At most 4",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "reason"],
        properties: {
          item: { type: "string", description: "dotaconstants item key (e.g. black_king_bar)" },
          reason: { type: "string", description: "Short reason" },
        },
      },
    },
    skill_priority: {
      type: "array",
      description: "Order to max basic abilities (no ultimate). Use only the given ability keys",
      items: { type: "string" },
    },
    tips: {
      type: "array",
      description: "Actionable play tips for right now. At most 4, one sentence each",
      items: { type: "string" },
    },
  },
} as const;

export const SYSTEM_PROMPT = `You are a Dota 2 coach. The player reads your advice on a second screen or an in-game overlay while playing.

Rules:
- Write in English. Keep every sentence short and immediately actionable; long text is not read mid-game.
- Always name items by their dotaconstants key (e.g. black_king_bar, blink, power_treads).
- skill_priority uses only keys from the input abilities list, basic abilities only, ultimate excluded, in maxing order.
- Do not recommend items the player already owns, or components of items they already built.
- rule_engine in the input is a stats- and rules-based recommendation. Follow it when you agree; when the enemy lineup or the situation calls for something better, change it and say why.
- If the enemy list is empty, do not assume an enemy lineup; advise from the player's hero and situation.
- If the player asked a question, answer it first in summary.
- If off_plan_purchase is present, the player just bought something other than the suggestion. Respect that choice: build around the item they bought, drop what it replaced, and say in summary how the plan changes.
- Do not state patch-specific numbers (exact cooldowns, damage) you are unsure of.`;

const mmss = (sec: number) => {
  const sign = sec < 0 ? "-" : "";
  const a = Math.abs(Math.floor(sec));
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
};

export function buildUserPayload(
  s: GameSnapshot,
  report: CoachReport,
  enemies: string[],
  question?: string,
  bought?: { item: string; name: string; replaced: string[] }[],
) {
  const hero = s.hero ? getHero(s.hero.name) : undefined;
  const ownedNames = [...s.items.inventory, ...s.items.backpack, ...s.items.stash].map((i) => i.name);
  return {
    clock: mmss(s.clockTime),
    phase: report.phase,
    role: report.role,
    team: s.team,
    score: s.score,
    hero: s.hero && {
      key: s.hero.name,
      name: hero?.localizedName,
      level: s.hero.level,
      alive: s.hero.alive,
      hp_pct: s.hero.healthPct,
      mana_pct: s.hero.manaPct,
      aghanims_scepter: s.hero.aghsScepter,
      aghanims_shard: s.hero.aghsShard,
      talents_taken: s.hero.talents.map((t, i) => (t ? i + 1 : 0)).filter(Boolean),
    },
    stats: s.player && {
      kda: report.stats.kda,
      last_hits: s.player.lastHits,
      denies: s.player.denies,
      gpm: s.player.gpm,
      xpm: s.player.xpm,
      gold: s.player.gold,
      net_worth_est: report.stats.netWorth,
    },
    items: ownedNames.map((k) => ({ key: k, name: getItem(k)?.name ?? k })),
    neutral_item: s.items.neutral?.name ?? null,
    has_tp: Boolean(s.items.teleport),
    abilities: s.abilities
      .filter((a) => !getAbility(a.name).innate)
      .map((a) => ({ key: a.name, name: getAbility(a.name).name, level: a.level, ultimate: a.ultimate })),
    enemies: enemies.map((k) => ({ key: k, name: getHero(k)?.localizedName ?? k })),
    rule_engine: {
      next_items: report.items.map((i) => ({ key: i.key, reason: i.reason })),
      unspent_skill_points: report.skills.unspent,
    },
    question: question?.trim() || undefined,
    off_plan_purchase: bought?.length
      ? bought.map((b) => ({ bought: b.item, name: b.name, instead_of: b.replaced }))
      : undefined,
  };
}
