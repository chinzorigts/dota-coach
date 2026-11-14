import type { RawGsi } from "../src/gsi/types.js";

export function rawGame(over: Partial<{
  clock: number; level: number; gold: number; deaths: number; items: string[]; tp: boolean;
  abilityLevels: number[]; hp: number; alive: boolean; talents: boolean[]; matchId: string; hero: string; heroId: number;
}> = {}): RawGsi {
  const o = {
    clock: 600, level: 7, gold: 1200, deaths: 0, items: ["power_treads", "magic_wand"], tp: true,
    abilityLevels: [3, 1, 2, 1], hp: 80, alive: true, talents: Array(8).fill(false),
    matchId: "123", hero: "npc_dota_hero_juggernaut", heroId: 8, ...over,
  };
  const names = ["juggernaut_blade_fury", "juggernaut_healing_ward", "juggernaut_blade_dance", "juggernaut_omni_slash"];
  const items: RawGsi["items"] = {};
  for (let i = 0; i < 9; i++) items[`slot${i}`] = { name: o.items[i] ? `item_${o.items[i]}` : "empty" };
  items.teleport0 = { name: o.tp ? "item_tpscroll" : "empty" };
  return {
    auth: { token: "test-token" },
    map: { matchid: o.matchId, clock_time: o.clock, game_time: o.clock + 90, daytime: true, game_state: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", radiant_score: 5, dire_score: 3 },
    player: { name: "p", team_name: "radiant", kills: 2, deaths: o.deaths, assists: 3, last_hits: 60, denies: 5, gold: o.gold, gpm: 450, xpm: 500 },
    hero: {
      id: o.heroId, name: o.hero, level: o.level, alive: o.alive, health_percent: o.hp, health: 500, max_health: 800,
      mana: 200, max_mana: 300, mana_percent: 66, buyback_cost: 400, buyback_cooldown: 0, attributes_level: 0,
      ...Object.fromEntries(o.talents.map((t, i) => [`talent_${i + 1}`, t])),
    },
    abilities: Object.fromEntries(names.map((name, i) => [`ability${i}`, { name, level: o.abilityLevels[i], ultimate: i === 3 }])),
    items,
  };
}

/** Advisor runtime for tests: fixed settings, all triggers on unless overridden */
export const rt =
  (enabled: boolean, over: Partial<{ minIntervalSec: number; triggers: Partial<Record<"hero" | "death" | "periodic" | "enemies", boolean>> }> = {}) =>
  () => ({
    enabled,
    model: "m",
    minIntervalSec: over.minIntervalSec ?? 90,
    triggers: { hero: true, death: true, periodic: true, enemies: true, ...over.triggers },
  });
