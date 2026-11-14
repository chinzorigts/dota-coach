// "How am I doing compared to the average?" for the hero being played right now.
//
// Live numbers come from GSI (only your own player). Two references:
//  - hero: OpenDota benchmarks, i.e. percentiles of whole-match per-minute stats for this hero
//  - you: your own per-minute averages on this hero (public profile only)
// Counting stats (kills, last hits, ...) are compared as "expected by this minute" = rate x minutes.
// GPM/XPM climb during a match while the references are whole-match values, so before EARLY_MINUTES the
// comparison is flagged as early and given no verdict.
import type { GameSnapshot } from "../gsi/normalize.js";
import type { BenchPoint, HeroBenchmarks, PlayerHeroTotals } from "../data/opendota.js";

export type StatKey = "kills" | "deaths" | "assists" | "lastHits" | "denies" | "gpm" | "xpm";

export interface StatRow {
  key: StatKey;
  label: string;
  value: number;
  /** Hero median at this point of the game (counts) or whole-match median (gpm/xpm) */
  heroMedian: number | null;
  /** Where your current rate sits among all players of the hero, 0..100 */
  heroPercentile: number | null;
  /** Your own average at this point of the game */
  personal: number | null;
  better: "higher" | "lower";
  verdict: "good" | "ok" | "bad" | null;
}

export interface BenchmarkView {
  minute: number;
  early: boolean;
  rows: StatRow[];
  /** Kill participation, (kills + assists) / team kills, as Dotabuff's "KP". null before the team has a kill. */
  killParticipation: number | null;
  hero: "ok" | "loading" | "none";
  personal: "ok" | "loading" | "none";
  personalGames: number | null;
}

export const EARLY_MINUTES = 10;
/** Per-minute rates in the first minutes are mostly noise (one kill at 0:40 = 1.5 kills/min) */
const MIN_MINUTES = 2;

/** Linear interpolation of the percentile a value falls on. Below the lowest point counts as that point. */
export function percentileOf(points: BenchPoint[], value: number): number | null {
  if (!points.length) return null;
  if (value <= points[0].value) return Math.round(points[0].percentile * 100);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (value <= b.value) {
      const t = b.value === a.value ? 1 : (value - a.value) / (b.value - a.value);
      return Math.round((a.percentile + t * (b.percentile - a.percentile)) * 100);
    }
  }
  return Math.round(points[points.length - 1].percentile * 100);
}

export function medianOf(points: BenchPoint[]): number | null {
  if (!points.length) return null;
  const exact = points.find((p) => p.percentile === 0.5);
  if (exact) return exact.value;
  // No exact 50th: interpolate between its neighbours
  const hi = points.findIndex((p) => p.percentile > 0.5);
  if (hi <= 0) return points[hi === 0 ? 0 : points.length - 1].value;
  const a = points[hi - 1];
  const b = points[hi];
  return a.value + ((0.5 - a.percentile) / (b.percentile - a.percentile)) * (b.value - a.value);
}

function verdictOf(row: Omit<StatRow, "verdict">, early: boolean): StatRow["verdict"] {
  if (early) return null;
  if (row.heroPercentile !== null) {
    const pct = row.better === "higher" ? row.heroPercentile : 100 - row.heroPercentile;
    return pct >= 60 ? "good" : pct <= 35 ? "bad" : "ok";
  }
  const ref = row.personal ?? row.heroMedian;
  if (ref === null) return null;
  // Small counts (2 deaths vs 1.6 expected) swing wildly as ratios; give them a little slack
  const slack = row.key === "gpm" || row.key === "xpm" ? 0 : 1;
  if (row.better === "higher") {
    if (row.value >= ref * 1.15 + slack * 0.5) return "good";
    if (row.value + slack < ref * 0.85) return "bad";
  } else {
    if (row.value + slack <= ref * 0.85) return "good";
    if (row.value > ref * 1.15 + slack) return "bad";
  }
  return "ok";
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function compareStats(
  snap: GameSnapshot,
  bench: HeroBenchmarks | null | "loading",
  totals: PlayerHeroTotals | null | "loading",
): BenchmarkView | null {
  const p = snap.player;
  if (!p || !snap.hero) return null;
  const minute = Math.max(0, snap.clockTime) / 60;
  const teamKills = snap.team ? snap.score[snap.team] : 0;
  const killParticipation = teamKills > 0 ? Math.min(100, Math.round(((p.kills + p.assists) / teamKills) * 100)) : null;
  if (minute < MIN_MINUTES) {
    return { minute: Math.floor(minute), early: true, rows: [], killParticipation, hero: bench === "loading" ? "loading" : bench ? "ok" : "none", personal: totals === "loading" ? "loading" : totals ? "ok" : "none", personalGames: totals && totals !== "loading" ? totals.games : null };
  }
  const early = minute < EARLY_MINUTES;
  const b = bench && bench !== "loading" ? bench : null;
  const t = totals && totals !== "loading" ? totals : null;

  const count = (key: StatKey, label: string, value: number, better: StatRow["better"], heroRate: BenchPoint[] | null, personalRate: number | null) => {
    const median = heroRate ? medianOf(heroRate) : null;
    const base = {
      key,
      label,
      value,
      heroMedian: median === null ? null : round1(median * minute),
      heroPercentile: heroRate ? percentileOf(heroRate, value / minute) : null,
      personal: personalRate === null ? null : round1(personalRate * minute),
      better,
    };
    return { ...base, verdict: verdictOf(base, early) };
  };
  const rate = (key: "gpm" | "xpm", label: string, value: number, points: BenchPoint[] | null, personal: number | null) => {
    const median = points ? medianOf(points) : null;
    const base = {
      key,
      label,
      value,
      heroMedian: median === null ? null : Math.round(median),
      heroPercentile: points ? percentileOf(points, value) : null,
      personal: personal === null ? null : Math.round(personal),
      better: "higher" as const,
    };
    return { ...base, verdict: verdictOf(base, early) };
  };

  const rows: StatRow[] = [
    count("kills", "Kills", p.kills, "higher", b?.killsPerMin.length ? b.killsPerMin : null, t?.perMin.kills ?? null),
    count("deaths", "Deaths", p.deaths, "lower", null, t?.perMin.deaths ?? null),
    count("assists", "Assists", p.assists, "higher", null, t?.perMin.assists ?? null),
    count("lastHits", "Last hits", p.lastHits, "higher", b?.lastHitsPerMin.length ? b.lastHitsPerMin : null, t?.perMin.lastHits ?? null),
    count("denies", "Denies", p.denies, "higher", null, t?.perMin.denies ?? null),
    rate("gpm", "GPM", p.gpm, b?.goldPerMin.length ? b.goldPerMin : null, t?.gpm ?? null),
    rate("xpm", "XPM", p.xpm, b?.xpPerMin.length ? b.xpPerMin : null, t?.xpm ?? null),
  ];

  return {
    minute: Math.floor(minute),
    early,
    // A row with nothing to compare against is just a number the HUD already shows
    rows: rows.filter((r) => r.heroMedian !== null || r.personal !== null),
    killParticipation,
    hero: bench === "loading" ? "loading" : b ? "ok" : "none",
    personal: totals === "loading" ? "loading" : t ? "ok" : "none",
    personalGames: t?.games ?? null,
  };
}
