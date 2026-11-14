import type { GameSnapshot } from "../gsi/normalize.js";
import { getAbility, getHero, getItem } from "../data/constants.js";
import type { CoachReport } from "../engine/types.js";

export const ADVICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "danger", "next_items", "skill_priority", "tips"],
  properties: {
    summary: { type: "string", description: "지금 상황 한두 문장 요약 (한국어)" },
    danger: { type: "string", enum: ["low", "medium", "high"] },
    next_items: {
      type: "array",
      description: "다음에 살 아이템 순서. 최대 4개",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "reason"],
        properties: {
          item: { type: "string", description: "dotaconstants 아이템 키 (예: black_king_bar)" },
          reason: { type: "string", description: "짧은 이유 (한국어)" },
        },
      },
    },
    skill_priority: {
      type: "array",
      description: "일반 스킬(궁극기 제외)을 마스터할 순서. 주어진 ability key 만 사용",
      items: { type: "string" },
    },
    tips: {
      type: "array",
      description: "지금 바로 실행할 수 있는 플레이 조언. 최대 4개, 각 한 문장 (한국어)",
      items: { type: "string" },
    },
  },
} as const;

export const SYSTEM_PROMPT = `당신은 Dota 2 코치입니다. 플레이어가 게임 중 두 번째 화면으로 보는 조언을 씁니다.

규칙:
- 모든 문장은 한국어로, 짧고 바로 실행할 수 있게 씁니다. 게임 중이라 긴 글은 읽히지 않습니다.
- 아이템은 반드시 dotaconstants 아이템 키(예: black_king_bar, blink, power_treads)로 적습니다.
- skill_priority 는 입력의 abilities 에 있는 key 만 쓰고, 궁극기는 빼고 일반 스킬만 순서대로 적습니다.
- 이미 가진 아이템이나 그 하위 부품은 추천하지 않습니다.
- 입력의 rule_engine 은 통계·규칙 기반 추천입니다. 동의하면 따르고, 적 조합이나 상황상 더 나은 선택이 있으면 바꾸고 이유를 적습니다.
- 적 영웅 목록이 비어 있으면 적 조합을 가정하지 말고 내 영웅·상황 중심으로 조언합니다.
- 플레이어가 질문(question)을 했다면 summary 에서 그 질문에 먼저 답합니다.
- 확실하지 않은 패치 수치(정확한 쿨다운, 데미지)는 단정하지 않습니다.`;

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
  };
}
