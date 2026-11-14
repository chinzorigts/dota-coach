// OpenDota: per-hero item popularity (real match stats). Called from the user's PC, cached on disk for 24h.
// Returns null on failure; the engine falls back to role-based default builds.
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { getItem, itemKeyById } from "./constants.js";

export interface ItemPopularity {
  start: string[];
  early: string[];
  mid: string[];
  late: string[];
}

const TTL_MS = 24 * 60 * 60 * 1000;
const memo = new Map<number, Promise<ItemPopularity | null>>();

function rank(bucket: Record<string, number> | undefined): string[] {
  return Object.entries(bucket ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => itemKeyById(id))
    .filter((k): k is string => Boolean(k && getItem(k)));
}

export function parsePopularity(raw: unknown): ItemPopularity {
  const r = (raw ?? {}) as Record<string, Record<string, number>>;
  return {
    start: rank(r.start_game_items),
    early: rank(r.early_game_items),
    mid: rank(r.mid_game_items),
    late: rank(r.late_game_items),
  };
}

async function load(heroId: number): Promise<ItemPopularity | null> {
  const file = path.join(config.cacheDir, `popularity-${heroId}.json`);
  try {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs < TTL_MS) {
      return parsePopularity(JSON.parse(await fs.readFile(file, "utf8")));
    }
  } catch {
    /* no cache */
  }
  try {
    const res = await fetch(`${config.opendotaBase}/heroes/${heroId}/itemPopularity`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    await fs.mkdir(config.cacheDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(raw));
    return parsePopularity(raw);
  } catch (err) {
    console.warn(`[opendota] item popularity for hero ${heroId} failed, using default build:`, (err as Error).message);
    return null;
  }
}

export function getItemPopularity(heroId: number): Promise<ItemPopularity | null> {
  let p = memo.get(heroId);
  if (!p) {
    p = load(heroId);
    memo.set(heroId, p);
    // Drop failures from the memo so the next call retries
    p.then((v) => v === null && memo.delete(heroId));
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Player summaries (rank, recent win rate, most played heroes) for the opponent panel.
// OpenDota's free tier allows 60 requests/min and 2000/day without a key, and each player costs up to
// 3 requests, so requests go through one queue spaced RATE_GAP_MS apart and results are cached on disk.

export interface PlayerSummary {
  accountId: number;
  name: string | null;
  avatar: string | null;
  /** OpenDota rank_tier: tens = medal (1 Herald .. 8 Immortal), ones = stars */
  rankTier: number | null;
  leaderboardRank: number | null;
  rank: string | null;
  /** Recent matches window used for wins/losses */
  recent: { games: number; wins: number; losses: number; winRate: number | null };
  topHeroes: { heroId: number; games: number; wins: number }[];
  /** Profile hidden or match data not exposed: OpenDota knows nothing useful */
  isPrivate: boolean;
  fetchedAt: number;
}

const PLAYER_TTL_MS = 6 * 60 * 60 * 1000;
const RECENT_GAMES = 20;
const RATE_GAP_MS = 1100;
const MEDALS = ["Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];

export function rankLabel(rankTier: number | null, leaderboardRank: number | null = null): string | null {
  if (!rankTier) return null;
  const medal = MEDALS[Math.floor(rankTier / 10) - 1];
  if (!medal) return null;
  if (medal === "Immortal") return leaderboardRank ? `Immortal #${leaderboardRank}` : "Immortal";
  const stars = rankTier % 10;
  return stars ? `${medal} ${stars}` : medal;
}

/** Builds a summary from the three OpenDota responses (/players/:id, /wl, /heroes). Exported for tests. */
export function parsePlayerSummary(accountId: number, profileRaw: unknown, wlRaw: unknown, heroesRaw: unknown, now = Date.now()): PlayerSummary {
  const p = (profileRaw ?? {}) as { profile?: { personaname?: string; avatarmedium?: string } | null; rank_tier?: number | null; leaderboard_rank?: number | null };
  const wl = (wlRaw ?? {}) as { win?: number; lose?: number };
  const wins = Number(wl.win) || 0;
  const losses = Number(wl.lose) || 0;
  const games = wins + losses;
  const heroes = Array.isArray(heroesRaw) ? (heroesRaw as { hero_id: number | string; games?: number; win?: number }[]) : [];
  const topHeroes = heroes
    .map((h) => ({ heroId: Number(h.hero_id), games: Number(h.games) || 0, wins: Number(h.win) || 0 }))
    .filter((h) => h.games > 0 && Number.isFinite(h.heroId))
    .sort((a, b) => b.games - a.games)
    .slice(0, 3);
  const rankTier = typeof p.rank_tier === "number" ? p.rank_tier : null;
  const leaderboardRank = typeof p.leaderboard_rank === "number" ? p.leaderboard_rank : null;
  return {
    accountId,
    name: p.profile?.personaname ?? null,
    avatar: p.profile?.avatarmedium ?? null,
    rankTier,
    leaderboardRank,
    rank: rankLabel(rankTier, leaderboardRank),
    recent: { games, wins, losses, winRate: games ? wins / games : null },
    topHeroes,
    // No profile at all, or a profile with zero recent public matches ("Expose Public Match Data" off)
    isPrivate: !p.profile || games === 0,
    fetchedAt: now,
  };
}

let queue: Promise<unknown> = Promise.resolve();
function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => new Promise((r) => setTimeout(r, RATE_GAP_MS)),
    () => new Promise((r) => setTimeout(r, RATE_GAP_MS)),
  );
  return run;
}

async function getJson(pathname: string): Promise<unknown> {
  return rateLimited(async () => {
    const res = await fetch(`${config.opendotaBase}${pathname}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

async function loadPlayer(accountId: number): Promise<PlayerSummary | null> {
  const file = path.join(config.cacheDir, "players", `${accountId}.json`);
  try {
    const cached = JSON.parse(await fs.readFile(file, "utf8")) as PlayerSummary;
    if (Date.now() - cached.fetchedAt < PLAYER_TTL_MS) return cached;
  } catch {
    /* no cache */
  }
  try {
    const profile = await getJson(`/players/${accountId}`);
    const hasProfile = Boolean((profile as { profile?: unknown })?.profile);
    // Skip the other two calls for unknown/private accounts: they would only return zeros
    const [wl, heroes] = hasProfile
      ? await Promise.all([
          getJson(`/players/${accountId}/wl?limit=${RECENT_GAMES}`),
          getJson(`/players/${accountId}/heroes?limit=${RECENT_GAMES}`),
        ])
      : [null, null];
    const summary = parsePlayerSummary(accountId, profile, wl, heroes);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(summary));
    return summary;
  } catch (err) {
    console.warn(`[opendota] player ${accountId} failed:`, (err as Error).message);
    return null;
  }
}

const playerMemo = new Map<number, Promise<PlayerSummary | null>>();

export function getPlayerSummary(accountId: number): Promise<PlayerSummary | null> {
  let p = playerMemo.get(accountId);
  if (!p) {
    p = loadPlayer(accountId);
    playerMemo.set(accountId, p);
    p.then((v) => {
      // Failures retry next time; successes expire with the disk cache
      if (v === null) playerMemo.delete(accountId);
      else setTimeout(() => playerMemo.delete(accountId), PLAYER_TTL_MS).unref?.();
    });
  }
  return p;
}
