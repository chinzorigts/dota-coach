import type { GameSnapshot } from "../gsi/normalize.js";
import { getHero, getItem, remainingCost } from "../data/constants.js";
import type { ItemPopularity } from "../data/opendota.js";
import { matchCounters } from "./counters.js";
import { isBootsUpgrade } from "./purchases.js";
import type { ItemRec, Role } from "./types.js";

/** Consumables and small parts that add noise to build recommendations */
const NOISE = new Set([
  "tango", "flask", "clarity", "enchanted_mango", "faerie_fire", "ward_observer", "ward_sentry",
  "ward_dispenser", "tpscroll", "smoke_of_deceit", "dust", "branches", "blood_grenade", "famango",
  "great_famango", "greater_famango", "aghanims_shard_roshan", "cheese", "refresher_shard",
]);

/** Fallback builds when OpenDota is unavailable. Safe, patch-agnostic staples only. */
const DEFAULT_BUILDS: Record<string, string[]> = {
  support: ["magic_wand", "arcane_boots", "glimmer_cape", "force_staff", "aether_lens", "ghost", "lotus_orb"],
  agi: ["magic_wand", "power_treads", "wraith_band", "black_king_bar", "manta", "butterfly", "satanic"],
  str: ["magic_wand", "phase_boots", "bracer", "blink", "black_king_bar", "heart", "assault"],
  int: ["magic_wand", "null_talisman", "arcane_boots", "blink", "black_king_bar", "sheepstick", "shivas_guard"],
  all: ["magic_wand", "phase_boots", "black_king_bar", "blink", "manta", "skadi"],
};

export function phaseOf(clock: number): "pre" | "early" | "mid" | "late" {
  if (clock <= 0) return "pre";
  if (clock < 12 * 60) return "early";
  if (clock < 28 * 60) return "mid";
  return "late";
}

export function inferRole(heroName: string | undefined): Role {
  const h = heroName ? getHero(heroName) : undefined;
  if (!h) return "core";
  return h.roles.includes("Support") && !h.roles.includes("Carry") ? "support" : "core";
}

export function ownedItems(s: GameSnapshot): string[] {
  const { inventory, backpack, stash } = s.items;
  return [...inventory, ...backpack, ...stash].map((i) => i.name);
}

/** Counts as owned if built, or if an owned item uses it as a component */
function hasEffectively(key: string, owned: string[]): boolean {
  if (owned.includes(key)) return true;
  return owned.some((o) => getItem(o)?.components.includes(key));
}

interface ItemContext {
  role: Role;
  popularity: ItemPopularity | null;
  enemies: string[];
  aiItems: { item: string; reason: string }[];
  /** Recommendations made redundant by what you bought instead (see purchases.ts) */
  skipped?: string[];
}

export function recommendItems(s: GameSnapshot, ctx: ItemContext): ItemRec[] {
  const owned = ownedItems(s);
  const gold = s.player?.gold ?? 0;
  const phase = phaseOf(s.clockTime);
  const recs = new Map<string, ItemRec>();

  const skipped = new Set(ctx.skipped ?? []);
  // One pair of upgraded boots is enough: once you have any, the others stop being suggested
  const hasBoots = owned.some(isBootsUpgrade);
  const add = (key: string, reason: string, source: ItemRec["source"], priority: number) => {
    const it = getItem(key);
    if (!it) return;
    if (source !== "rule" && (skipped.has(key) || (hasBoots && isBootsUpgrade(key)))) return;
    const existing = recs.get(key);
    if (existing) {
      // When several sources agree, bump priority and join the reasons
      existing.priority = Math.max(existing.priority, priority) + 5;
      if (!existing.reason.includes(reason)) existing.reason += ` · ${reason}`;
      return;
    }
    const remaining = remainingCost(key, owned);
    recs.set(key, {
      key,
      name: it.name,
      img: it.img,
      cost: it.cost,
      remaining,
      affordable: gold >= remaining,
      reason,
      source,
      priority,
    });
  };

  // 1) Basic rule: TP scroll
  if (s.clockTime > 0 && !s.items.teleport && !owned.includes("tpscroll")) {
    add("tpscroll", "No TP scroll. Always carry one", "rule", 100);
  }

  // 2) AI picks (the source that sees the most context)
  ctx.aiItems.forEach((a, i) => {
    if (!hasEffectively(a.item, owned)) add(a.item, a.reason, "ai", 80 - i * 3);
  });

  // 3) Enemy lineup counters
  for (const m of matchCounters(ctx.enemies, ctx.role)) {
    const names = m.matched.map((k) => getHero(`npc_dota_hero_${k}`)?.localizedName ?? k).join(", ");
    m.items.slice(0, 2).forEach((key, i) => {
      if (!hasEffectively(key, owned)) {
        add(key, `Counters ${m.rule.label} (${names})`, "counter", 60 + m.matched.length * 5 - i * 4);
      }
    });
  }

  // 4) Meta build: current phase + next phase
  const hero = s.hero ? getHero(s.hero.name) : undefined;
  let meta: string[];
  let metaLabel: string;
  if (ctx.popularity) {
    const p = ctx.popularity;
    const order =
      phase === "pre" ? [p.start, p.early]
      : phase === "early" ? [p.early, p.mid]
      : phase === "mid" ? [p.mid, p.late]
      : [p.late];
    meta = order.flat();
    metaLabel = "Popular build for this hero";
  } else {
    meta = DEFAULT_BUILDS[ctx.role === "support" ? "support" : (hero?.primaryAttr ?? "all")];
    metaLabel = "Default build";
  }
  meta
    .filter((k) => !NOISE.has(k) && !hasEffectively(k, owned) && !getItem(k)?.consumable)
    .slice(0, 4)
    .forEach((key, i) => add(key, metaLabel, "meta", 50 - i * 4));

  // 5) Support basics
  if (ctx.role === "support" && s.clockTime > 0) {
    const wards = owned.includes("ward_observer") || owned.includes("ward_dispenser");
    if (!wards) add("ward_observer", "No wards. Get vision up", "rule", 55);
  }

  return [...recs.values()].sort((a, b) => b.priority - a.priority).slice(0, 6);
}
