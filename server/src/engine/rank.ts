// Medal, MMR and "how far to the next star / medal".
//
// Valve publishes no official MMR table. These are the community bands most guides agree on:
// Herald..Ancient are 770 MMR each (five stars of 154), Divine starts at 4620 with stars of 160, Immortal is
// 5420+ and ranked by leaderboard instead of stars. They shift a little between seasons, so the UI calls them
// estimates. Your exact MMR is on your Dota profile; GSI and OpenDota only know the medal (rank_tier).

export const MEDALS = ["Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"] as const;
export type Medal = (typeof MEDALS)[number];

const MEDAL_WIDTH = 770;
const STAR = 154;
const DIVINE_START = 4620;
const DIVINE_STAR = 160;
export const IMMORTAL_START = 5420;

export interface Band {
  medal: Medal;
  stars: number; // 1..5, 0 for Immortal
  /** rank_tier as OpenDota writes it: tens = medal (1..8), ones = stars */
  tier: number;
  from: number;
  to: number | null; // exclusive; null = open-ended (Immortal)
}

/** Every star band from Herald 1 to Immortal, in order */
export const BANDS: Band[] = (() => {
  const out: Band[] = [];
  for (let m = 0; m < 6; m++) {
    for (let s = 1; s <= 5; s++) {
      const from = m * MEDAL_WIDTH + (s - 1) * STAR;
      // Close the last star of each medal on the medal boundary so 154*5 = 770 adds up exactly
      out.push({ medal: MEDALS[m], stars: s, tier: (m + 1) * 10 + s, from, to: s === 5 ? (m + 1) * MEDAL_WIDTH : from + STAR });
    }
  }
  for (let s = 1; s <= 5; s++) {
    const from = DIVINE_START + (s - 1) * DIVINE_STAR;
    out.push({ medal: "Divine", stars: s, tier: 70 + s, from, to: s === 5 ? IMMORTAL_START : from + DIVINE_STAR });
  }
  out.push({ medal: "Immortal", stars: 0, tier: 80, from: IMMORTAL_START, to: null });
  return out;
})();

export const bandLabel = (b: Band) => (b.stars ? `${b.medal} ${b.stars}` : b.medal);

export function bandForMmr(mmr: number): Band {
  for (let i = BANDS.length - 1; i >= 0; i--) if (mmr >= BANDS[i].from) return BANDS[i];
  return BANDS[0];
}

export function bandForTier(tier: number | null): Band | null {
  if (!tier) return null;
  if (tier >= 80) return BANDS[BANDS.length - 1];
  return BANDS.find((b) => b.tier === tier) ?? null;
}

export interface RankView {
  /**
   * Where the MMR comes from. Valve only shows the exact number on your own in-game profile, so by default it's
   * collected automatically: OpenDota's estimate from your recent ranked matches ("estimate"), else the middle of
   * your medal's range ("medal"). A number typed in Settings wins ("mmr").
   */
  source: "mmr" | "estimate" | "medal" | "none";
  /** True whenever the number isn't the one you typed: the UI prefixes it with "≈" */
  approximate: boolean;
  mmr: number | null;
  label: string | null;
  medal: Medal | null;
  stars: number | null;
  /** Medal from OpenDota, shown next to the typed MMR so a stale MMR is easy to spot */
  openDotaLabel: string | null;
  nextStar: { label: string; mmr: number; remaining: number; wins: number } | null;
  nextMedal: { label: string; mmr: number; remaining: number; wins: number } | null;
  /** Progress through the current star, 0..1 (null when unknown) */
  progress: number | null;
  perGame: number;
  /** Last automatic change after a game, so the UI can show it (and offer undo) */
  lastChange: { delta: number; matchId: string; at: number } | null;
  estimated: true;
}

const winsFor = (remaining: number, perGame: number) => Math.max(1, Math.ceil(remaining / perGame));

export function rankView(opts: {
  /** Typed in Settings */
  mmr: number | null;
  /** OpenDota computed_mmr */
  computedMmr?: number | null;
  rankTier: number | null;
  perGame: number;
  /** Wins/losses since the estimate was fetched, so it moves right after a game */
  offset?: number;
  lastChange?: RankView["lastChange"];
}): RankView {
  const { rankTier, perGame } = opts;
  const od = bandForTier(rankTier);
  const base = {
    openDotaLabel: od ? bandLabel(od) : null,
    perGame,
    lastChange: opts.lastChange ?? null,
    estimated: true as const,
  };

  // Typed-in MMR first, then OpenDota's estimate, then the middle of the medal band (Immortal: its floor)
  const offset = opts.offset ?? 0;
  let source: RankView["source"] = "none";
  let mmr: number | null = null;
  if (opts.mmr !== null) {
    source = "mmr";
    mmr = opts.mmr;
  } else if (opts.computedMmr) {
    source = "estimate";
    mmr = Math.max(0, opts.computedMmr + offset);
  } else if (od) {
    source = "medal";
    mmr = Math.max(0, (od.to === null ? od.from : Math.round((od.from + od.to) / 2)) + offset);
  }

  if (mmr !== null) {
    const band = bandForMmr(mmr);
    const i = BANDS.indexOf(band);
    const next = BANDS[i + 1] ?? null;
    const nextMedal = BANDS.slice(i + 1).find((b) => b.medal !== band.medal) ?? null;
    const target = (b: Band | null) => (b ? { label: bandLabel(b), mmr: b.from, remaining: b.from - mmr, wins: winsFor(b.from - mmr, perGame) } : null);
    return {
      ...base,
      source,
      approximate: source !== "mmr",
      mmr,
      label: bandLabel(band),
      medal: band.medal,
      stars: band.stars || null,
      nextStar: target(next),
      // Within the last star the next star *is* the next medal; show it once
      nextMedal: nextMedal && nextMedal !== next ? target(nextMedal) : null,
      progress: band.to === null ? null : (mmr - band.from) / (band.to - band.from),
    };
  }

  return { ...base, source: "none", approximate: true, mmr: null, label: null, medal: null, stars: null, nextStar: null, nextMedal: null, progress: null };
}

/**
 * MMR change for a finished game, or null when it shouldn't count (no result yet, unknown side).
 * GSI sends win_team once the ancient falls; each match is applied once by the caller.
 */
export function gameResultDelta(winTeam: string | undefined, myTeam: "radiant" | "dire" | null, perGame: number): number | null {
  if (!myTeam || (winTeam !== "radiant" && winTeam !== "dire")) return null;
  return winTeam === myTeam ? perGame : -perGame;
}
