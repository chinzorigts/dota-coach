import type { GameSnapshot } from "../gsi/normalize.js";
import { getHero, getItem, remainingCost } from "../data/constants.js";
import type { ItemPopularity } from "../data/opendota.js";
import { matchCounters } from "./counters.js";
import type { ItemRec, Role } from "./types.js";

/** 빌드 추천에 섞으면 시끄러운 소모품·자잘한 부품 */
const NOISE = new Set([
  "tango", "flask", "clarity", "enchanted_mango", "faerie_fire", "ward_observer", "ward_sentry",
  "ward_dispenser", "tpscroll", "smoke_of_deceit", "dust", "branches", "blood_grenade", "famango",
  "great_famango", "greater_famango", "aghanims_shard_roshan", "cheese", "refresher_shard",
]);

/** OpenDota 를 못 쓸 때의 기본 빌드. 패치 특화가 아닌 무난한 축만 둔다. */
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

/** 이미 완성했거나, 그 아이템을 부품으로 쓴 상위 아이템이 있으면 가진 것으로 본다 */
function hasEffectively(key: string, owned: string[]): boolean {
  if (owned.includes(key)) return true;
  return owned.some((o) => getItem(o)?.components.includes(key));
}

interface ItemContext {
  role: Role;
  popularity: ItemPopularity | null;
  enemies: string[];
  aiItems: { item: string; reason: string }[];
}

export function recommendItems(s: GameSnapshot, ctx: ItemContext): ItemRec[] {
  const owned = ownedItems(s);
  const gold = s.player?.gold ?? 0;
  const phase = phaseOf(s.clockTime);
  const recs = new Map<string, ItemRec>();

  const add = (key: string, reason: string, source: ItemRec["source"], priority: number) => {
    const it = getItem(key);
    if (!it) return;
    const existing = recs.get(key);
    if (existing) {
      // 여러 근거가 겹치면 우선순위를 올리고 이유를 잇는다
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

  // 1) 기본 규칙: TP 스크롤
  if (s.clockTime > 0 && !s.items.teleport && !owned.includes("tpscroll")) {
    add("tpscroll", "TP 스크롤이 없습니다 — 항상 하나는 들고 다니세요", "rule", 100);
  }

  // 2) AI 추천 (가장 상황을 많이 본 근거)
  ctx.aiItems.forEach((a, i) => {
    if (!hasEffectively(a.item, owned)) add(a.item, a.reason, "ai", 80 - i * 3);
  });

  // 3) 적 조합 카운터
  for (const m of matchCounters(ctx.enemies, ctx.role)) {
    const names = m.matched.map((k) => getHero(`npc_dota_hero_${k}`)?.localizedName ?? k).join(", ");
    m.items.slice(0, 2).forEach((key, i) => {
      if (!hasEffectively(key, owned)) {
        add(key, `${m.rule.label} 대응 (${names})`, "counter", 60 + m.matched.length * 5 - i * 4);
      }
    });
  }

  // 4) 메타 빌드: 지금 페이즈 + 다음 페이즈
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
    metaLabel = "이 영웅 인기 빌드";
  } else {
    meta = DEFAULT_BUILDS[ctx.role === "support" ? "support" : (hero?.primaryAttr ?? "all")];
    metaLabel = "기본 빌드";
  }
  meta
    .filter((k) => !NOISE.has(k) && !hasEffectively(k, owned) && !getItem(k)?.consumable)
    .slice(0, 4)
    .forEach((key, i) => add(key, metaLabel, "meta", 50 - i * 4));

  // 5) 서포터 기본기
  if (ctx.role === "support" && s.clockTime > 0) {
    const wards = owned.includes("ward_observer") || owned.includes("ward_dispenser");
    if (!wards) add("ward_observer", "시야 장악 — 와드가 없습니다", "rule", 55);
  }

  return [...recs.values()].sort((a, b) => b.priority - a.priority).slice(0, 6);
}
