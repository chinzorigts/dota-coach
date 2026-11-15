// Static hero/item/ability data from npm `dotaconstants` (OpenDota's official constants), so it works offline.
import * as dc from "dotaconstants";

interface RawHero {
  id: number;
  name: string;
  localized_name: string;
  primary_attr: "str" | "agi" | "int" | "all";
  attack_type: "Melee" | "Ranged";
  roles: string[];
  img: string;
  icon: string;
}
interface RawItem {
  id: number;
  dname?: string;
  cost?: number | null;
  qual?: string;
  img?: string;
  components?: string[] | null;
}
interface RawAbility {
  dname?: string;
  is_innate?: boolean;
  behavior?: string | string[];
  img?: string;
  /** Per-level lists (mana cost, cooldown, attribute values): their length is the ability's level count */
  mc?: unknown;
  cd?: unknown;
  attrib?: { value?: unknown }[];
}
interface RawHeroAbilities {
  abilities: string[];
  talents: { name: string; level: number }[];
}

// The package blocks build/*.json subpaths via exports, so use the main entry's named exports
const heroes = dc.heroes as unknown as Record<string, RawHero>;
const items = dc.items as unknown as Record<string, RawItem>;
const abilities = dc.abilities as unknown as Record<string, RawAbility>;
const heroAbilities = dc.hero_abilities as unknown as Record<string, RawHeroAbilities>;
const itemIds = dc.item_ids as unknown as Record<string, string>;

export const CDN = "https://cdn.cloudflare.steamstatic.com";

export interface HeroInfo {
  id: number;
  name: string;
  localizedName: string;
  primaryAttr: RawHero["primary_attr"];
  attackType: RawHero["attack_type"];
  roles: string[];
  img: string;
  icon: string;
}

const heroById = new Map<number, HeroInfo>();
const heroByName = new Map<string, HeroInfo>();
for (const h of Object.values(heroes)) {
  const info: HeroInfo = {
    id: h.id,
    name: h.name,
    localizedName: h.localized_name,
    primaryAttr: h.primary_attr,
    attackType: h.attack_type,
    roles: h.roles ?? [],
    img: CDN + h.img.replace(/\?$/, ""),
    icon: CDN + h.icon.replace(/\?$/, ""),
  };
  heroById.set(h.id, info);
  heroByName.set(h.name, info);
}

export const getHero = (idOrName: number | string): HeroInfo | undefined =>
  typeof idOrName === "number" ? heroById.get(idOrName) : heroByName.get(idOrName);

export const allHeroes = (): HeroInfo[] =>
  [...heroById.values()].sort((a, b) => a.localizedName.localeCompare(b.localizedName));

export interface ItemInfo {
  key: string;
  id: number;
  name: string;
  cost: number;
  img: string;
  components: string[];
  consumable: boolean;
}

export function getItem(key: string): ItemInfo | undefined {
  const it = items[key];
  if (!it) return undefined;
  return {
    key,
    id: it.id,
    name: it.dname ?? key,
    cost: it.cost ?? 0,
    img: it.img ? CDN + it.img.split("?")[0] : "",
    components: it.components ?? [],
    consumable: it.qual === "consumable",
  };
}

export const itemKeyById = (id: number | string): string | undefined => itemIds[String(id)];

/** key -> items that list it as a direct component (built once, on first use) */
let builtFromIndex: Map<string, string[]> | null = null;

/** Items you can build that use `key` as a direct part (e.g. ogre_axe -> black_king_bar, ...) */
export function itemsBuiltFrom(key: string): string[] {
  if (!builtFromIndex) {
    builtFromIndex = new Map();
    for (const [k, it] of Object.entries(items)) {
      if (k.startsWith("recipe_") || !it.components?.length || (it.cost ?? 0) <= 0) continue;
      for (const c of new Set(it.components)) {
        const list = builtFromIndex.get(c) ?? [];
        list.push(k);
        builtFromIndex.set(c, list);
      }
    }
  }
  return builtFromIndex.get(key) ?? [];
}

/** Neutral items of one tier (1..5) in the installed dotaconstants, i.e. the current patch's list */
export function neutralItemsOfTier(tier: number): { key: string; name: string }[] {
  return Object.entries(items)
    .filter(([, it]) => (it as RawItem & { tier?: number }).tier === tier)
    .map(([key, it]) => ({ key, name: it.dname ?? key }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const neutralTierOf = (key: string): number | null => (items[key] as (RawItem & { tier?: number }) | undefined)?.tier ?? null;

export interface AbilityInfo {
  key: string;
  name: string;
  innate: boolean;
  img: string;
}

/**
 * Some talent names keep Valve's value placeholders ("+{s:bonus_movement_speed}% Infest Move Speed").
 * The number isn't in the data, so drop the placeholder and a trailing %/s with it: "+ Infest Move Speed".
 */
export function cleanTemplate(name: string): string {
  return name.replace(/\{s:[^}]*\}[%s]?/g, "").replace(/\s{2,}/g, " ").replace(/^\+\s*/, "+").trim();
}

export function getAbility(key: string): AbilityInfo {
  const a = abilities[key];
  return {
    key,
    name: a?.dname ? cleanTemplate(a.dname) : prettify(key),
    innate: Boolean(a?.is_innate),
    img: a?.img ? CDN + a.img.split("?")[0] : "",
  };
}

/** How many levels an ability has, read from its per-level value lists (mana cost, cooldown, attributes) */
export function abilityMaxLevel(key: string): number {
  const a = abilities[key];
  if (!a) return 1;
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 1);
  return Math.max(len(a.mc), len(a.cd), ...(a.attrib ?? []).map((x) => len(x.value)));
}

/** Second halves of abilities that share one level: one skill point raises both, so only the first is counted */
const LINKED_TWINS = new Set(["morphling_morph_str"]);

/**
 * Does this ability take skill points of its own? Not innates, not hidden sub-abilities (Kunkka's Return,
 * Invoker's invoked spells, Rubick's Telekinesis Land), not single-level extras (Shard/Scepter abilities,
 * empty slots), and not the twin of a linked pair (Morphling's Attribute Shift).
 */
export function takesSkillPoints(key: string): boolean {
  const a = abilities[key];
  if (!a || a.is_innate || LINKED_TWINS.has(key)) return false;
  const behavior = Array.isArray(a.behavior) ? a.behavior : [a.behavior ?? ""];
  return !behavior.includes("Hidden") && abilityMaxLevel(key) >= 3;
}

export function getHeroAbilities(heroName: string): RawHeroAbilities | undefined {
  return heroAbilities[heroName];
}

function prettify(key: string) {
  return key.replace(/^special_bonus_/, "").replace(/_/g, " ");
}

/**
 * Gold still needed to complete `key`, given the items already owned.
 * Looks at direct components only (recursing would double-count finished intermediate items).
 */
export function remainingCost(key: string, owned: string[]): number {
  const it = getItem(key);
  if (!it) return 0;
  const pool = [...owned];
  let paid = 0;
  for (const c of it.components) {
    const idx = pool.indexOf(c);
    if (idx >= 0) {
      paid += getItem(c)?.cost ?? 0;
      pool.splice(idx, 1);
    }
  }
  return Math.max(0, it.cost - paid);
}
