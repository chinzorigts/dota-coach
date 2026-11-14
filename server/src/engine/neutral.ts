// Neutral item pick for the tier that's available right now.
//
// Tiers open on the game clock. Which item of the tier fits is a judgment call (hero, role, enemies), so the
// AI chooses, but only from the real list of that tier in the installed data (no invented or old-patch items).
// The rule engine contributes the timing, the options and "you already hold it".
import type { GameSnapshot } from "../gsi/normalize.js";
import { getItem, neutralItemsOfTier, neutralTierOf } from "../data/constants.js";

/** Minute each tier unlocks (1..5) */
export const NEUTRAL_TIER_MINUTES = [5, 15, 25, 35, 60] as const;

export function neutralTier(clockSec: number): number {
  let tier = 0;
  NEUTRAL_TIER_MINUTES.forEach((m, i) => {
    if (clockSec >= m * 60) tier = i + 1;
  });
  return tier;
}

export interface NeutralView {
  tier: number;
  /** Game clock (seconds) when the next tier opens, null after tier 5 */
  nextTierAt: number | null;
  holding: { key: string; name: string; tier: number | null } | null;
  pick: { key: string; name: string; reason: string; held: boolean } | null;
  options: { key: string; name: string }[];
}

export function buildNeutral(s: GameSnapshot, aiPick: { item: string; reason: string } | null | undefined): NeutralView | null {
  const tier = neutralTier(s.clockTime);
  const next = NEUTRAL_TIER_MINUTES[tier];
  const holdingKey = s.items.neutral?.name ?? null;
  const holding = holdingKey ? { key: holdingKey, name: getItem(holdingKey)?.name ?? holdingKey, tier: neutralTierOf(holdingKey) } : null;
  if (tier === 0) return holding ? { tier, nextTierAt: next * 60, holding, pick: null, options: [] } : null;
  const options = neutralItemsOfTier(tier);
  // An AI pick from an earlier tier is out of date once a new tier opens
  const valid = aiPick && options.some((o) => o.key === aiPick.item) ? aiPick : null;
  return {
    tier,
    nextTierAt: next ? next * 60 : null,
    holding,
    pick: valid ? { key: valid.item, name: getItem(valid.item)?.name ?? valid.item, reason: valid.reason, held: valid.item === holdingKey } : null,
    options,
  };
}
