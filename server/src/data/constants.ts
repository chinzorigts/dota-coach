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

export interface AbilityInfo {
  key: string;
  name: string;
  innate: boolean;
  img: string;
}

export function getAbility(key: string): AbilityInfo {
  const a = abilities[key];
  return {
    key,
    name: a?.dname ?? prettify(key),
    innate: Boolean(a?.is_innate),
    img: a?.img ? CDN + a.img.split("?")[0] : "",
  };
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
