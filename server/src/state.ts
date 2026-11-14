import type { RawGsi } from "./gsi/types.js";
import { normalize, type GameSnapshot } from "./gsi/normalize.js";
import { getAbility, getHero, getItem } from "./data/constants.js";
import { getItemPopularity, type ItemPopularity } from "./data/opendota.js";
import { buildReport, type CoachReport, type RolePref } from "./engine/index.js";
import type { Advisor } from "./ai/advisor.js";

export class CoachState {
  snapshot: GameSnapshot | null = null;
  report: CoachReport | null = null;
  enemies: string[] = [];
  rolePref: RolePref = "auto";
  popularity: ItemPopularity | null = null;
  popularityHero: number | null = null;
  lastGsiAt = 0;
  private matchId: string | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private advisor: Advisor,
    private loadPopularity: (heroId: number) => Promise<ItemPopularity | null> = getItemPopularity,
  ) {
    advisor.onChange(() => {
      this.recompute(); // AI picks feed the item/skill ranking, so recompute
      this.emit();
    });
  }

  onChange(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }

  ingest(raw: RawGsi) {
    const snap = normalize(raw);
    this.lastGsiAt = snap.receivedAt;

    // New match: clear match-scoped state
    if (snap.matchId && snap.matchId !== this.matchId) {
      this.matchId = snap.matchId;
      this.enemies = [];
      this.advisor.reset();
    }

    if (snap.hero && snap.hero.id !== this.popularityHero) {
      this.popularityHero = snap.hero.id;
      this.popularity = null;
      const heroId = snap.hero.id;
      this.loadPopularity(heroId).then((p) => {
        if (this.popularityHero !== heroId) return;
        this.popularity = p;
        this.recompute();
        this.emit();
      });
    }

    this.snapshot = snap;
    this.recompute();
    if (this.snapshot && this.report) {
      void this.advisor.onSnapshot(this.snapshot, this.report, this.enemies);
    }
    this.emit();
  }

  setEnemies(heroes: string[]) {
    const valid = [...new Set(heroes)].filter((h) => getHero(h)).slice(0, 5);
    const changed = valid.join() !== this.enemies.join();
    this.enemies = valid;
    this.recompute();
    if (changed) void this.advisor.onEnemiesChanged(this.snapshot, this.report, this.enemies);
    this.emit();
  }

  setRole(role: RolePref) {
    this.rolePref = role;
    this.recompute();
    this.emit();
  }

  recompute() {
    if (!this.snapshot) return;
    const advice = this.advisor.status().advice;
    this.report = buildReport(this.snapshot, {
      rolePref: this.rolePref,
      popularity: this.popularity,
      enemies: this.enemies,
      ai: advice ? { items: advice.next_items, skillPriority: advice.skill_priority } : null,
    });
  }

  toJSON() {
    const hero = this.snapshot?.hero ? getHero(this.snapshot.hero.name) : undefined;
    return {
      serverTime: Date.now(),
      lastGsiAt: this.lastGsiAt,
      snapshot: this.snapshot,
      heroInfo: hero ?? null,
      report: this.report,
      enemies: this.enemies,
      rolePref: this.rolePref,
      popularitySource: this.popularity ? "opendota" : "default",
      ai: this.advisor.status(),
      // Display names for the UI (the snapshot only has internal keys)
      names: this.displayNames(),
    };
  }

  private displayNames() {
    const s = this.snapshot;
    const abilities: Record<string, string> = {};
    const items: Record<string, string> = {};
    if (!s) return { abilities, items };
    for (const a of s.abilities) abilities[a.name] = getAbility(a.name).name;
    const all = [...s.items.inventory, ...s.items.backpack, ...s.items.stash, s.items.teleport, s.items.neutral];
    for (const i of all) if (i) items[i.name] = getItem(i.name)?.name ?? i.name;
    for (const i of this.advisor.status().advice?.next_items ?? []) items[i.item] = getItem(i.item)?.name ?? i.item;
    return { abilities, items };
  }
}
