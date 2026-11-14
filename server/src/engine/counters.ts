// 적 영웅 조합 → 상황별 아이템. 패치마다 세부는 바뀌지만 "왜 이 아이템인가"의 축은 오래 간다.
// 영웅 키는 npc 이름에서 접두사를 뗀 것(dotaconstants 와 같은 표기).
import type { Role } from "./types.js";

export interface CounterRule {
  id: string;
  label: string; // 화면에 보일 이유
  heroes: string[];
  core: string[];
  support: string[];
}

export const COUNTER_RULES: CounterRule[] = [
  {
    id: "invis",
    label: "투명 영웅",
    heroes: ["riki", "bounty_hunter", "clinkz", "weaver", "nyx_assassin", "mirana", "invoker", "treant"],
    core: ["dust", "ward_sentry", "gem"],
    support: ["dust", "ward_sentry", "gem"],
  },
  {
    id: "illusion",
    label: "환영 영웅",
    heroes: ["phantom_lancer", "naga_siren", "terrorblade", "chaos_knight", "meepo", "arc_warden"],
    core: ["mjollnir", "bfury", "radiance"],
    support: ["shivas_guard", "crimson_guard"],
  },
  {
    id: "heal",
    label: "회복·재생 의존 영웅",
    heroes: ["necrolyte", "huskar", "alchemist", "morphling", "abaddon", "dazzle", "oracle", "omniknight", "witch_doctor"],
    core: ["skadi", "spirit_vessel", "shivas_guard"],
    support: ["spirit_vessel"],
  },
  {
    id: "evasion",
    label: "회피 영웅",
    heroes: ["phantom_assassin", "brewmaster", "windrunner", "troll_warlord"],
    core: ["monkey_king_bar", "bloodthorn"],
    support: ["ghost", "solar_crest"],
  },
  {
    id: "magic",
    label: "마법 폭딜·하드 디스에이블",
    heroes: ["lion", "lina", "shadow_shaman", "zuus", "skywrath_mage", "leshrac", "bane", "enigma", "tinker", "pugna", "queenofpain", "puck"],
    core: ["black_king_bar", "pipe"],
    support: ["glimmer_cape", "pipe", "force_staff"],
  },
  {
    id: "silence",
    label: "침묵·루트",
    heroes: ["silencer", "skywrath_mage", "drow_ranger", "night_stalker", "death_prophet", "doom_bringer", "riki", "grimstroke"],
    core: ["manta", "lotus_orb"],
    support: ["lotus_orb", "cyclone"],
  },
  {
    id: "physical",
    label: "물리 폭딜",
    heroes: ["phantom_assassin", "sven", "troll_warlord", "ursa", "juggernaut", "slark", "monkey_king", "life_stealer"],
    core: ["blade_mail", "shivas_guard", "butterfly"],
    support: ["ghost", "force_staff", "crimson_guard"],
  },
  {
    id: "buff",
    label: "강한 버프(디스펠 필요)",
    heroes: ["ogre_magi", "omniknight", "abaddon", "legion_commander", "dazzle", "medusa"],
    core: ["nullifier"],
    support: ["nullifier", "cyclone"],
  },
];

export interface CounterMatch {
  rule: CounterRule;
  matched: string[];
  items: string[];
}

export function matchCounters(enemies: string[], role: Role): CounterMatch[] {
  const keys = enemies.map((e) => e.replace(/^npc_dota_hero_/, ""));
  return COUNTER_RULES.map((rule) => {
    const matched = keys.filter((k) => rule.heroes.includes(k));
    return { rule, matched, items: role === "core" ? rule.core : rule.support };
  })
    .filter((m) => m.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length);
}
