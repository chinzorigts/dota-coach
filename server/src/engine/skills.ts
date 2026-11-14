import type { GameSnapshot } from "../gsi/normalize.js";
import { getAbility, getHeroAbilities } from "../data/constants.js";
import type { SkillRec } from "./types.js";

/** Levels that grant no ability point (7.33+ rules) */
const NO_POINT_LEVELS = new Set([17, 19, 21, 22, 23, 24]);
const TALENT_TIERS = [10, 15, 20, 25];

export function pointsEarned(level: number): number {
  let pts = 0;
  for (let l = 1; l <= Math.min(level, 30); l++) if (!NO_POINT_LEVELS.has(l)) pts++;
  return pts;
}

/** The hero's own skills that take points: no innates, and nothing that isn't in the hero's ability list */
function levelableAbilities(s: GameSnapshot) {
  const own = s.hero ? getHeroAbilities(s.hero.name)?.abilities : undefined;
  const ownSet = own?.length ? new Set(own) : null;
  return s.abilities.filter((a) => !getAbility(a.name).innate && (!ownSet || ownSet.has(a.name)));
}

/** Approximate: abilities granted at level 1 by Shard/Scepter can make this undercount */
export function unspentPoints(s: GameSnapshot): number {
  if (!s.hero) return 0;
  const spent =
    levelableAbilities(s).reduce((sum, a) => sum + a.level, 0) +
    s.hero.talents.filter(Boolean).length +
    s.hero.attributesLevel;
  return Math.max(0, pointsEarned(s.hero.level) - spent);
}

export const ultCap = (level: number) => (level >= 18 ? 3 : level >= 12 ? 2 : level >= 6 ? 1 : 0);
export const basicCap = (level: number) => Math.min(4, Math.ceil(level / 2));

export function defaultPriority(s: GameSnapshot): string[] {
  return levelableAbilities(s)
    .filter((a) => !a.ultimate)
    .map((a) => a.name);
}

/**
 * The pick at your next level-up: the same rules run one level ahead. Skips levels that grant no point.
 * Null when a point is already waiting (that one is `next`) or there's nothing left to level.
 */
export function upcomingSkill(s: GameSnapshot, aiPriority: string[] | null): (SkillRec & { atLevel: number }) | null {
  const hero = s.hero;
  if (!hero || unspentPoints(s) > 0) return null;
  let level = hero.level + 1;
  while (level <= 30 && NO_POINT_LEVELS.has(level)) level++;
  if (level > 30) return null;
  const ahead: GameSnapshot = { ...s, hero: { ...hero, level } };
  const next = recommendSkill(ahead, aiPriority).next;
  return next ? { ...next, atLevel: level } : null;
}

export function recommendSkill(
  s: GameSnapshot,
  aiPriority: string[] | null,
): { unspent: number; next: SkillRec | null; priority: string[]; prioritySource: "ai" | "default" } {
  const unspent = unspentPoints(s);
  const fallback = defaultPriority(s);
  const known = new Set(fallback);
  const ai = (aiPriority ?? []).filter((k) => known.has(k));
  // If the AI listed only some abilities, fill the rest in default order
  const priority = ai.length ? [...ai, ...fallback.filter((k) => !ai.includes(k))] : fallback;
  const prioritySource = ai.length ? "ai" : "default";

  const hero = s.hero;
  if (!hero || unspent === 0) return { unspent, next: null, priority, prioritySource };

  const abilities = levelableAbilities(s);

  // 1) Ultimate
  const ult = abilities.find((a) => a.ultimate);
  if (ult && ult.level < ultCap(hero.level)) {
    return {
      unspent,
      priority,
      prioritySource,
      next: { kind: "ability", key: ult.name, name: getAbility(ult.name).name, reason: `Ultimate level ${ult.level + 1}: always take it when available` },
    };
  }

  // 2) Talents
  const talents = getHeroAbilities(hero.name)?.talents ?? [];
  for (let tier = 0; tier < TALENT_TIERS.length; tier++) {
    if (hero.level < TALENT_TIERS[tier]) break;
    const taken = hero.talents[tier * 2] || hero.talents[tier * 2 + 1];
    if (taken) continue;
    const options = talents
      .filter((t) => t.level === tier + 1)
      .map((t) => ({ key: t.name, name: getAbility(t.name).name }));
    return {
      unspent,
      priority,
      prioritySource,
      next: {
        kind: "talent",
        key: `talent_tier_${TALENT_TIERS[tier]}`,
        name: `Level ${TALENT_TIERS[tier]} talent`,
        reason: "Talent not picked yet",
        options,
      },
    };
  }

  // 3) Basic abilities: by priority, within the level cap
  const cap = basicCap(hero.level);
  for (const key of priority) {
    const a = abilities.find((x) => x.name === key);
    if (a && a.level < cap && a.level < 4) {
      const rank = priority.indexOf(key) + 1;
      return {
        unspent,
        priority,
        prioritySource,
        next: {
          kind: "ability",
          key,
          name: getAbility(key).name,
          reason: `${prioritySource === "ai" ? "AI" : "Default"} priority #${rank}, to level ${a.level + 1}`,
        },
      };
    }
  }
  return { unspent, next: null, priority, prioritySource };
}
