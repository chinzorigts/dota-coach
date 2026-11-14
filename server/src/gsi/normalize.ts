import type { RawGsi, RawItem } from "./types.js";
import { accountIdFromSteamId64 } from "../matchlog/parser.js";

export interface AbilityState {
  slot: number;
  name: string;
  level: number;
  canCast: boolean;
  passive: boolean;
  cooldown: number;
  ultimate: boolean;
}

export interface ItemState {
  slot: string; // slot0..8, stash0..5, teleport0, neutral0
  name: string; // "blink" (item_ prefix stripped)
  charges?: number;
  cooldown: number;
}

export interface HeroState {
  id: number;
  name: string; // npc_dota_hero_juggernaut
  level: number;
  alive: boolean;
  respawnSeconds: number;
  buybackCost: number;
  buybackCooldown: number;
  health: number;
  maxHealth: number;
  healthPct: number;
  mana: number;
  maxMana: number;
  manaPct: number;
  aghsScepter: boolean;
  aghsShard: boolean;
  attributesLevel: number;
  /** talent_1..8. Index 0,1 = level 10 tier, 2,3 = 15, 4,5 = 20, 6,7 = 25 */
  talents: boolean[];
  disabled: string[]; // stunned/silenced/hexed...
}

export interface GameSnapshot {
  receivedAt: number;
  matchId: string | null;
  gameState: string;
  inProgress: boolean;
  clockTime: number;
  gameTime: number;
  daytime: boolean;
  paused: boolean;
  team: "radiant" | "dire" | null;
  /** Set once the game is decided (ancient destroyed) */
  winTeam: "radiant" | "dire" | null;
  score: { radiant: number; dire: number };
  roshan: { state: string; endSeconds: number } | null;
  player: {
    name: string;
    accountId: number | null;
    kills: number;
    deaths: number;
    assists: number;
    lastHits: number;
    denies: number;
    gold: number;
    goldReliable: number;
    goldUnreliable: number;
    gpm: number;
    xpm: number;
  } | null;
  hero: HeroState | null;
  abilities: AbilityState[];
  /** Hero ids per team when GSI exposes them (spectating, or draft data). Empty while playing normally. */
  lineup: { radiant: number[]; dire: number[] };
  items: {
    inventory: ItemState[];
    backpack: ItemState[];
    stash: ItemState[];
    teleport: ItemState | null;
    neutral: ItemState | null;
  };
}

function lineupFrom(raw: RawGsi): { radiant: number[]; dire: number[] } {
  const ids = (team: "team2" | "team3") => {
    const out = new Set<number>();
    // Spectator: hero.team2.player0.id
    for (const p of Object.values(raw.hero?.[team] ?? {})) {
      if (typeof p?.id === "number" && p.id > 0) out.add(p.id);
    }
    // Draft: draft.team2.pick0_id
    for (const [k, v] of Object.entries(raw.draft?.[team] ?? {})) {
      if (/^pick\d+_id$/.test(k) && typeof v === "number" && v > 0) out.add(v);
    }
    return [...out].slice(0, 5);
  };
  return { radiant: ids("team2"), dire: ids("team3") };
}

const n = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function toItem(slot: string, raw: RawItem | undefined): ItemState | null {
  if (!raw?.name || raw.name === "empty") return null;
  return {
    slot,
    name: raw.name.replace(/^item_/, ""),
    charges: typeof raw.charges === "number" ? raw.charges : undefined,
    cooldown: n(raw.cooldown),
  };
}

export function normalize(raw: RawGsi, now = Date.now()): GameSnapshot {
  const map = raw.map ?? {};
  const gameState = map.game_state ?? "UNKNOWN";
  const team =
    raw.player?.team_name === "radiant" || raw.player?.team_name === "dire"
      ? raw.player.team_name
      : null;

  const abilities: AbilityState[] = Object.entries(raw.abilities ?? {})
    .map(([key, a]) => ({
      slot: Number(key.replace("ability", "")),
      name: a.name ?? "",
      level: n(a.level),
      canCast: Boolean(a.can_cast),
      passive: Boolean(a.passive),
      cooldown: n(a.cooldown),
      ultimate: Boolean(a.ultimate),
    }))
    .filter((a) => a.name && !a.name.startsWith("generic_hidden"))
    .sort((a, b) => a.slot - b.slot);

  const items = raw.items ?? {};
  const pick = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, i) => toItem(`${prefix}${i}`, items[`${prefix}${i}`])).filter(
      (x): x is ItemState => x !== null,
    );

  const h = raw.hero;
  const hero: HeroState | null =
    h && typeof h.id === "number" && h.id > 0 && h.name
      ? {
          id: h.id,
          name: h.name,
          level: n(h.level, 1),
          alive: h.alive !== false,
          respawnSeconds: n(h.respawn_seconds),
          buybackCost: n(h.buyback_cost),
          buybackCooldown: n(h.buyback_cooldown),
          health: n(h.health),
          maxHealth: n(h.max_health),
          healthPct: n(h.health_percent, 100),
          mana: n(h.mana),
          maxMana: n(h.max_mana),
          manaPct: n(h.mana_percent, 100),
          aghsScepter: Boolean(h.aghanims_scepter),
          aghsShard: Boolean(h.aghanims_shard),
          attributesLevel: n(h.attributes_level),
          talents: [1, 2, 3, 4, 5, 6, 7, 8].map(
            (i) => Boolean((h as Record<string, unknown>)[`talent_${i}`]),
          ),
          disabled: (["stunned", "silenced", "hexed", "disarmed"] as const).filter((k) => h[k]),
        }
      : null;

  const p = raw.player;
  return {
    receivedAt: now,
    matchId: map.matchid && map.matchid !== "0" ? map.matchid : null,
    gameState,
    inProgress:
      gameState === "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" ||
      gameState === "DOTA_GAMERULES_STATE_PRE_GAME",
    clockTime: n(map.clock_time),
    gameTime: n(map.game_time),
    daytime: map.daytime !== false,
    paused: Boolean(map.paused),
    team,
    winTeam: map.win_team === "radiant" || map.win_team === "dire" ? map.win_team : null,
    score: { radiant: n(map.radiant_score), dire: n(map.dire_score) },
    roshan: map.roshan_state
      ? { state: map.roshan_state, endSeconds: n(map.roshan_state_end_seconds) }
      : null,
    player: p
      ? {
          name: p.name ?? "",
          // 32-bit account ID, used to find which side of the server_log lobby is ours
          accountId: accountIdFromSteamId64(p.steamid),
          kills: n(p.kills),
          deaths: n(p.deaths),
          assists: n(p.assists),
          lastHits: n(p.last_hits),
          denies: n(p.denies),
          gold: n(p.gold),
          goldReliable: n(p.gold_reliable),
          goldUnreliable: n(p.gold_unreliable),
          gpm: n(p.gpm),
          xpm: n(p.xpm),
        }
      : null,
    hero,
    lineup: lineupFrom(raw),
    abilities,
    items: {
      inventory: pick("slot", 6),
      backpack: pick("slot", 9).filter((i) => Number(i.slot.slice(4)) >= 6),
      stash: pick("stash", 6),
      teleport: toItem("teleport0", items["teleport0"]),
      neutral: toItem("neutral0", items["neutral0"]),
    },
  };
}
