// Notices what you buy and adapts when it isn't what was recommended.
//
// GSI sends the inventory every update, so a purchase is simply "an item that wasn't there before" (counted, so
// a second Bracer counts too). When the item wasn't on the recommendation list, the build moves on:
//  - boots: any boots upgrade settles the boots slot, so other boots upgrades stop being suggested
//  - other completed items: the top recommendation of a similar price is treated as replaced ("you went Battle
//    Fury instead of Maelstrom") and dropped for the rest of the match
// The AI is then asked again with what changed (see Advisor.onPurchase).
import { getItem } from "../data/constants.js";
import type { ItemRec } from "./types.js";

/** Bought items worth reacting to: real build items, not consumables or wards */
const IGNORE = new Set([
  "tango", "flask", "clarity", "enchanted_mango", "faerie_fire", "ward_observer", "ward_sentry", "ward_dispenser",
  "tpscroll", "smoke_of_deceit", "dust", "blood_grenade", "famango", "great_famango", "greater_famango", "cheese",
  "aghanims_shard_roshan", "refresher_shard", "branches",
]);
/** Below this an item is a component on the way to something, not a choice of build */
const MIN_CHOICE_COST = 1000;

const BOOTS_UPGRADES = new Set([
  "power_treads", "phase_boots", "arcane_boots", "tranquil_boots", "boots_of_bearing", "guardian_greaves",
  "travel_boots", "travel_boots_2", "boots_of_elves_upgrade",
]);
export const isBootsUpgrade = (key: string) => BOOTS_UPGRADES.has(key) || (key.includes("boots") && key !== "boots" && (getItem(key)?.cost ?? 0) >= 900);

/** Items present now that weren't before (multiset difference, so duplicates count) */
export function newItems(before: string[], after: string[]): string[] {
  const left = new Map<string, number>();
  for (const k of before) left.set(k, (left.get(k) ?? 0) + 1);
  const out: string[] = [];
  for (const k of after) {
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else out.push(k);
  }
  return out.filter((k) => !IGNORE.has(k) && getItem(k) && !getItem(k)!.consumable);
}

export interface Purchase {
  item: string;
  name: string;
  clock: number;
  /** It was on the list (or a part of something on the list) */
  followed: boolean;
  /** Recommendations it made redundant, dropped from now on */
  replaced: string[];
}

/** Is `key` on the way to, or the same as, a recommended item? */
function partOfRecommendation(key: string, recs: ItemRec[]): boolean {
  return recs.some((r) => r.key === key || getItem(r.key)?.components.includes(key));
}

/**
 * Classify a purchase against the recommendations shown just before it.
 * Small components on the way to something only count as "followed" when they're part of a recommendation;
 * otherwise they're ignored (null) because they don't say anything about the build yet.
 */
export function classifyPurchase(key: string, recs: ItemRec[], clock: number): Purchase | null {
  const it = getItem(key);
  if (!it) return null;
  if (partOfRecommendation(key, recs)) return { item: key, name: it.name, clock, followed: true, replaced: [] };
  if (isBootsUpgrade(key)) {
    return { item: key, name: it.name, clock, followed: false, replaced: recs.filter((r) => isBootsUpgrade(r.key)).map((r) => r.key) };
  }
  // Basic items (Ogre Axe, Demon Edge...) are parts of something bigger; only finished items say "different build"
  if (it.cost < MIN_CHOICE_COST || it.components.length === 0) return null;
  // The recommendation it most plausibly replaced: the first similar-priced build item (rules like TP/wards aren't choices)
  const replaced = recs.find((r) => r.source !== "rule" && r.cost >= it.cost * 0.5 && r.cost <= it.cost * 2 && !isBootsUpgrade(r.key));
  return { item: key, name: it.name, clock, followed: false, replaced: replaced ? [replaced.key] : [] };
}
