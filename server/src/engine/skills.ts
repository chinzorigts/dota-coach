import type { GameSnapshot } from "../gsi/normalize.js";
import { getAbility, getHeroAbilities } from "../data/constants.js";
import type { SkillRec } from "./types.js";

/** 스킬 포인트를 주지 않는 레벨 (7.33+ 규칙) */
const NO_POINT_LEVELS = new Set([17, 19, 21, 22, 23, 24]);
const TALENT_TIERS = [10, 15, 20, 25];

export function pointsEarned(level: number): number {
  let pts = 0;
  for (let l = 1; l <= Math.min(level, 30); l++) if (!NO_POINT_LEVELS.has(l)) pts++;
  return pts;
}

function levelableAbilities(s: GameSnapshot) {
  return s.abilities.filter((a) => !getAbility(a.name).innate);
}

/** 근사치다: 샤드/셉터로 생기는 1레벨 스킬이 있으면 실제보다 적게 나올 수 있다 */
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

export function recommendSkill(
  s: GameSnapshot,
  aiPriority: string[] | null,
): { unspent: number; next: SkillRec | null; priority: string[]; prioritySource: "ai" | "default" } {
  const unspent = unspentPoints(s);
  const fallback = defaultPriority(s);
  const known = new Set(fallback);
  const ai = (aiPriority ?? []).filter((k) => known.has(k));
  // AI 가 일부만 말했으면 나머지는 기본 순서로 채운다
  const priority = ai.length ? [...ai, ...fallback.filter((k) => !ai.includes(k))] : fallback;
  const prioritySource = ai.length ? "ai" : "default";

  const hero = s.hero;
  if (!hero || unspent === 0) return { unspent, next: null, priority, prioritySource };

  const abilities = levelableAbilities(s);

  // 1) 궁극기
  const ult = abilities.find((a) => a.ultimate);
  if (ult && ult.level < ultCap(hero.level)) {
    return {
      unspent,
      priority,
      prioritySource,
      next: { kind: "ability", key: ult.name, name: getAbility(ult.name).name, reason: `궁극기 ${ult.level + 1}레벨 — 찍을 수 있으면 우선` },
    };
  }

  // 2) 특성
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
        name: `${TALENT_TIERS[tier]}레벨 특성`,
        reason: "특성을 아직 고르지 않았습니다",
        options,
      },
    };
  }

  // 3) 일반 스킬: 우선순위대로, 레벨 제한 안에서
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
          reason: `${prioritySource === "ai" ? "AI" : "기본"} 우선순위 ${rank}번 → ${a.level + 1}레벨`,
        },
      };
    }
  }
  return { unspent, next: null, priority, prioritySource };
}
