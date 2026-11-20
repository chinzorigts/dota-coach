// Pick suggestions during the draft: heroes that fit your position and do well against the enemy picks.
//
// Matchup advantage follows the idea behind Dotabuff's "Advantage" column: how much better a hero does against
// a specific enemy than you'd expect from both heroes' overall win rates.
//   expected = 0.5 + (candidate win rate - 0.5) - (enemy win rate - 0.5)
//   advantage = actual head-to-head win rate - expected
// Head-to-head samples are small, so each advantage is shrunk towards 0 by games / (games + SHRINK).
// Base win rates come from your medal bracket when OpenDota knows it.
import type { HeroInfo } from "../data/constants.js";
import type { HeroStat, LaneShares, Matchups } from "../data/opendota.js";
import type { Position } from "../settings.js";

const SHRINK = 150;
const MIN_GAMES = 20;
/** Very rarely picked heroes have noisy stats and are usually niche picks; skip them */
const MIN_PICK_SHARE = 0.25;

export interface PickReason {
  enemy: string; // localized name
  advantage: number; // percentage points
}

export interface PickSuggestion {
  hero: string; // npc_dota_hero_*
  name: string;
  icon: string;
  score: number;
  /** Win rate in your bracket (or overall), 0..100 */
  winRate: number | null;
  fit: number; // 0..1 how well the hero suits the position
  reasons: PickReason[];
}

export interface DraftView {
  position: Position;
  enemies: string[];
  status: "ok" | "loading" | "no-data";
  bracket: number | null;
  suggestions: PickSuggestion[];
}

const POSITION_ROLES: Record<Exclude<Position, 0>, { need: string[]; plus: string[]; minus: string[] }> = {
  1: { need: ["Carry"], plus: ["Escape", "Durable", "Pusher"], minus: ["Support"] },
  2: { need: ["Carry", "Nuker"], plus: ["Escape", "Disabler", "Initiator"], minus: ["Support"] },
  3: { need: ["Initiator", "Durable"], plus: ["Disabler", "Pusher"], minus: ["Support"] },
  4: { need: ["Support", "Initiator"], plus: ["Disabler", "Nuker", "Escape"], minus: ["Carry"] },
  5: { need: ["Support"], plus: ["Disabler", "Nuker"], minus: ["Carry", "Pusher"] },
};

/** 0..1. A hero lacking every "need" role doesn't fit; each plus/minus moves it a little. */
export function positionFit(roles: string[], position: Position): number {
  if (position === 0) return 1;
  const r = POSITION_ROLES[position];
  if (!r.need.some((n) => roles.includes(n))) return 0;
  let fit = 0.6;
  for (const p of r.plus) if (roles.includes(p)) fit += 0.1;
  for (const m of r.minus) if (roles.includes(m)) fit -= 0.2;
  return Math.max(0, Math.min(1, fit));
}

/** Lane role each position plays in: 1 safe lane (pos 1 and 5), 2 mid, 3 off lane (pos 3 and 4) */
const POSITION_LANE: Record<Exclude<Position, 0>, 1 | 2 | 3> = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 1 };
/** Below this share of games in the position's lane, the hero isn't really played there */
const MIN_LANE_SHARE = 0.08;
const MIN_LANE_GAMES = 200;

/**
 * Role tags only say what a hero can do; where people actually play it is the better guide (Lina is tagged
 * Support and Carry but lives in mid). Blends the tag fit with the share of games in the position's lane.
 * Returns the tag fit unchanged without lane data, and 0 when the hero is almost never played in that lane.
 */
export function laneAdjustedFit(tagFit: number, lanes: LaneShares | undefined, position: Position): number {
  if (position === 0 || !lanes || lanes.games < MIN_LANE_GAMES) return tagFit;
  const share = lanes.share[POSITION_LANE[position]];
  if (share < MIN_LANE_SHARE) return 0;
  return Math.round(Math.min(1, tagFit * 0.6 + Math.min(1, share / 0.5) * 0.4) * 100) / 100;
}

function baseWinRate(stat: HeroStat | undefined, bracket: number | null): number {
  if (!stat) return 0.5;
  const b = bracket ? stat.byBracket[bracket] : undefined;
  return (b && b.picks >= 200 ? b.winRate : stat.winRate) ?? 0.5;
}

/** Candidate's head-to-head edge over one enemy, from the enemy's matchup list. null when the sample is too small. */
export function matchupAdvantage(
  enemyMatchups: Matchups,
  candidateId: number,
  candidateBase: number,
  enemyBase: number,
): { advantage: number; games: number } | null {
  const m = enemyMatchups.get(candidateId);
  if (!m || m.games < MIN_GAMES) return null;
  const actual = 1 - m.wins / m.games; // the list holds the enemy's wins
  const expected = 0.5 + (candidateBase - 0.5) - (enemyBase - 0.5);
  return { advantage: (actual - expected) * (m.games / (m.games + SHRINK)), games: m.games };
}

export function suggestPicks(opts: {
  heroes: HeroInfo[];
  enemies: HeroInfo[];
  taken: Set<number>;
  position: Position;
  bracket: number | null;
  stats: Map<number, HeroStat>;
  matchups: Map<number, Matchups>; // by enemy hero id
  /** Lane shares by hero id, for the heroes loaded so far */
  lanes?: Map<number, LaneShares>;
  limit?: number;
}): PickSuggestion[] {
  const { heroes, enemies, taken, position, bracket, stats, matchups } = opts;
  const picks = [...stats.values()].map((s) => s.picks).sort((a, b) => a - b);
  const pickFloor = picks.length ? picks[Math.floor(picks.length * MIN_PICK_SHARE)] : 0;

  const out: PickSuggestion[] = [];
  for (const h of heroes) {
    if (taken.has(h.id)) continue;
    const tagFit = positionFit(h.roles, position);
    if (tagFit < 0.5) continue;
    const fit = laneAdjustedFit(tagFit, opts.lanes?.get(h.id), position);
    if (fit < 0.4) continue;
    const stat = stats.get(h.id);
    if (stat && stat.picks < pickFloor) continue;
    const base = baseWinRate(stat, bracket);

    const reasons: PickReason[] = [];
    let edge = 0;
    for (const e of enemies) {
      const m = matchups.get(e.id);
      if (!m) continue;
      const a = matchupAdvantage(m, h.id, base, baseWinRate(stats.get(e.id), bracket));
      if (!a) continue;
      edge += a.advantage;
      reasons.push({ enemy: e.localizedName, advantage: Math.round(a.advantage * 1000) / 10 });
    }
    // Matchups dominate once enemies are known; before that, bracket win rate and fit pick a solid default
    const score = edge * 100 + (base - 0.5) * (enemies.length ? 30 : 100) + fit * 2;
    out.push({
      hero: h.name,
      name: h.localizedName,
      icon: h.icon,
      score: Math.round(score * 10) / 10,
      winRate: stat ? Math.round(base * 1000) / 10 : null,
      fit,
      reasons: reasons.sort((a, b) => b.advantage - a.advantage).slice(0, 3),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 6);
}
