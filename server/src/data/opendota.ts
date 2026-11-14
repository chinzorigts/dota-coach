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
// 2 requests, so requests go through one queue spaced RATE_GAP_MS apart and results are cached on disk.
// /players/:id answers fast; match-based endpoints are slow and flaky (/wl often doesn't answer within 40s,
// /recentMatches takes ~12s or returns 500), so recent stats are optional: on failure the rank still shows.

export interface PlayerSummary {
  accountId: number;
  name: string | null;
  avatar: string | null;
  /** OpenDota rank_tier: tens = medal (1 Herald .. 8 Immortal), ones = stars */
  rankTier: number | null;
  leaderboardRank: number | null;
  rank: string | null;
  /** Last RECENT_GAMES public matches; null when OpenDota couldn't deliver them this time */
  recent: { games: number; wins: number; losses: number; winRate: number | null } | null;
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

interface RawRecentMatch { hero_id?: number | string; player_slot?: number; radiant_win?: boolean }

/**
 * Builds a summary from /players/:id and /players/:id/recentMatches.
 * `recentRaw` undefined = that request failed (stats unknown); [] = no public matches. Exported for tests.
 */
export function parsePlayerSummary(accountId: number, profileRaw: unknown, recentRaw: unknown, now = Date.now()): PlayerSummary {
  const p = (profileRaw ?? {}) as { profile?: { personaname?: string; avatarmedium?: string } | null; rank_tier?: number | null; leaderboard_rank?: number | null };
  const matches = Array.isArray(recentRaw) ? (recentRaw as RawRecentMatch[]).slice(0, RECENT_GAMES) : null;
  let recent: PlayerSummary["recent"] = null;
  let topHeroes: PlayerSummary["topHeroes"] = [];
  if (matches) {
    const byHero = new Map<number, { heroId: number; games: number; wins: number }>();
    let wins = 0;
    let games = 0;
    for (const m of matches) {
      if (typeof m.radiant_win !== "boolean" || typeof m.player_slot !== "number") continue;
      const won = m.player_slot < 128 === m.radiant_win;
      games++;
      if (won) wins++;
      const heroId = Number(m.hero_id);
      if (!Number.isFinite(heroId) || heroId <= 0) continue;
      const h = byHero.get(heroId) ?? { heroId, games: 0, wins: 0 };
      h.games++;
      if (won) h.wins++;
      byHero.set(heroId, h);
    }
    recent = { games, wins, losses: games - wins, winRate: games ? wins / games : null };
    topHeroes = [...byHero.values()].sort((a, b) => b.games - a.games || b.wins - a.wins).slice(0, 3);
  }
  const rankTier = typeof p.rank_tier === "number" ? p.rank_tier : null;
  const leaderboardRank = typeof p.leaderboard_rank === "number" ? p.leaderboard_rank : null;
  return {
    accountId,
    name: p.profile?.personaname ?? null,
    avatar: p.profile?.avatarmedium ?? null,
    rankTier,
    leaderboardRank,
    rank: rankLabel(rankTier, leaderboardRank),
    recent,
    topHeroes,
    // No profile at all, or a profile with zero recent public matches ("Expose Public Match Data" off)
    isPrivate: !p.profile || recent?.games === 0,
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

async function getJson(pathname: string, timeoutMs = 8000): Promise<unknown> {
  return rateLimited(async () => {
    const res = await fetch(`${config.opendotaBase}${pathname}`, { signal: AbortSignal.timeout(timeoutMs) });
    // OpenDota answers 404 for accounts it has never seen (or that hide everything): that's a valid "nothing known"
    if (res.status === 404 && /^\/players\/\d+$/.test(pathname)) return null;
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
    // Skip the match request for unknown/private accounts: it would only return nothing
    let recent: unknown = [];
    if (hasProfile) {
      recent = await getJson(`/players/${accountId}/recentMatches`, 20000).catch((err) => {
        console.warn(`[opendota] recent matches for ${accountId} unavailable:`, (err as Error).message);
        return undefined;
      });
    }
    const summary = parsePlayerSummary(accountId, profile, recent);
    // A partial summary (no recent stats) is shown but not cached, so the next match retries
    if (summary.recent || summary.isPrivate) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(summary));
    }
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
      if (v === null || (!v.recent && !v.isPrivate)) playerMemo.delete(accountId);
      else setTimeout(() => playerMemo.delete(accountId), PLAYER_TTL_MS).unref?.();
    });
  }
  return p;
}
