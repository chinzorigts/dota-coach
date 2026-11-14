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
  // Look ahead to the first level that has a real pick. Levels in between may only offer attributes
  // (e.g. at 16 with basics maxed and both talents taken, the next real pick is the ultimate at 18).
  // The point count is ignored here on purpose: GSI can report more spent levels than points earned
  // (innates that level on their own), which would hide every future pick.
  for (let level = hero.level + 1; level <= 30; level++) {
    if (NO_POINT_LEVELS.has(level)) continue;
    const p = priorityFor(s, aiPriority);
    const next = choosePick({ ...s, hero: { ...hero, level } }, p.priority, p.prioritySource);
    if (next) return { ...next, atLevel: level };
  }
  return null;
}

function priorityFor(s: GameSnapshot, aiPriority: string[] | null) {
  const fallback = defaultPriority(s);
  const known = new Set(fallback);
  const ai = (aiPriority ?? []).filter((k) => known.has(k));
  // If the AI listed only some abilities, fill the rest in default order
  const priority = ai.length ? [...ai, ...fallback.filter((k) => !ai.includes(k))] : fallback;
  return { priority, prioritySource: (ai.length ? "ai" : "default") as "ai" | "default" };
}

/** The pick at the hero's current level, by ultimate > talent > basic priority, ignoring how many points are free */
function choosePick(s: GameSnapshot, priority: string[], source: "ai" | "default"): SkillRec | null {
  return recommendSkillAt(s, priority, source).next;
}

export function recommendSkill(
  s: GameSnapshot,
  aiPriority: string[] | null,
): { unspent: number; next: SkillRec | null; priority: string[]; prioritySource: "ai" | "default" } {
  let unspent = unspentPoints(s);
  const { priority, prioritySource } = priorityFor(s, aiPriority);
  let next = s.hero && unspent > 0 ? recommendSkillAt(s, priority, prioritySource).next : null;
  if (s.hero && unspent === 0) {
    // GSI sometimes reports more spent levels than points earned (innates and such), which would hide a real
    // free point. A talent tier you've reached but not taken, or an ultimate below its cap, can only mean a
    // point is waiting, so show it as available.
    const pick = recommendSkillAt(s, priority, prioritySource).next;
    const ultReady = pick?.kind === "ability" && pick.reason.startsWith("Ultimate");
    if (pick && (pick.kind === "talent" || ultReady)) {
      next = pick;
      unspent = 1;
    }
  }
  return { unspent, next, priority, prioritySource };
}

/** What to level at the hero's current level, given a priority. Doesn't check whether a point is free. */
function recommendSkillAt(s: GameSnapshot, priority: string[], prioritySource: "ai" | "default"): { next: SkillRec | null } {
  const hero = s.hero;
  if (!hero) return { next: null };

  const abilities = levelableAbilities(s);

  // 1) Ultimate
  const ult = abilities.find((a) => a.ultimate);
  if (ult && ult.level < ultCap(hero.level)) {
    return {
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
        next: {
          kind: "ability",
          key,
          name: getAbility(key).name,
          reason: `${prioritySource === "ai" ? "AI" : "Default"} priority #${rank}, to level ${a.level + 1}`,
        },
      };
    }
  }
  return { next: null };
}
