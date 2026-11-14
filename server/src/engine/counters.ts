// Enemy lineup -> situational items. Details shift per patch, but the "why this item" logic lasts.
// Hero keys are npc names without the prefix (same spelling as dotaconstants).
import type { Role } from "./types.js";

export interface CounterRule {
  id: string;
  label: string; // reason shown in the UI
  heroes: string[];
  core: string[];
  support: string[];
}

export const COUNTER_RULES: CounterRule[] = [
  {
    id: "invis",
    label: "invisible heroes",
    heroes: ["riki", "bounty_hunter", "clinkz", "weaver", "nyx_assassin", "mirana", "invoker", "treant"],
    core: ["dust", "ward_sentry", "gem"],
    support: ["dust", "ward_sentry", "gem"],
  },
  {
    id: "illusion",
    label: "illusion heroes",
    heroes: ["phantom_lancer", "naga_siren", "terrorblade", "chaos_knight", "meepo", "arc_warden"],
    core: ["mjollnir", "bfury", "radiance"],
    support: ["shivas_guard", "crimson_guard"],
  },
  {
    id: "heal",
    label: "heal/regen reliant heroes",
    heroes: ["necrolyte", "huskar", "alchemist", "morphling", "abaddon", "dazzle", "oracle", "omniknight", "witch_doctor"],
    core: ["skadi", "spirit_vessel", "shivas_guard"],
    support: ["spirit_vessel"],
  },
  {
    id: "evasion",
    label: "evasion",
    heroes: ["phantom_assassin", "brewmaster", "windrunner", "troll_warlord"],
    core: ["monkey_king_bar", "bloodthorn"],
    support: ["ghost", "solar_crest"],
  },
  {
    id: "magic",
    label: "magic burst & hard disables",
    heroes: ["lion", "lina", "shadow_shaman", "zuus", "skywrath_mage", "leshrac", "bane", "enigma", "tinker", "pugna", "queenofpain", "puck"],
    core: ["black_king_bar", "pipe"],
    support: ["glimmer_cape", "pipe", "force_staff"],
  },
  {
    id: "silence",
    label: "silences & roots",
    heroes: ["silencer", "skywrath_mage", "drow_ranger", "night_stalker", "death_prophet", "doom_bringer", "riki", "grimstroke"],
    core: ["manta", "lotus_orb"],
    support: ["lotus_orb", "cyclone"],
  },
  {
    id: "physical",
    label: "physical burst",
    heroes: ["phantom_assassin", "sven", "troll_warlord", "ursa", "juggernaut", "slark", "monkey_king", "life_stealer"],
    core: ["blade_mail", "shivas_guard", "butterfly"],
    support: ["ghost", "force_staff", "crimson_guard"],
  },
  {
    id: "buff",
    label: "strong buffs (need dispel)",
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
