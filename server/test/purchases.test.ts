import { describe, expect, it } from "vitest";
import { classifyPurchase, isBootsUpgrade, newItems } from "../src/engine/purchases.js";
import { normalize } from "../src/gsi/normalize.js";
import { recommendItems } from "../src/engine/items.js";
import type { ItemRec } from "../src/engine/types.js";
import { getItem } from "../src/data/constants.js";
import { CoachState } from "../src/state.js";
import { Advisor } from "../src/ai/advisor.js";
import { SettingsStore } from "../src/settings.js";
import { rawGame, rt } from "./fixtures.js";

const rec = (key: string, source: ItemRec["source"] = "meta"): ItemRec => {
  const it = getItem(key)!;
  return { key, name: it.name, img: it.img, cost: it.cost, remaining: it.cost, affordable: false, reason: "", source, priority: 50 };
};

describe("respawn trigger", () => {
  it("asks again the moment the hero respawns", async () => {
    const { decideTrigger } = await import("../src/ai/advisor.js");
    const alive = normalize(rawGame({ alive: true }));
    const key = `${alive.matchId}:${alive.hero!.name}`;
    const mem = { key, deaths: alive.player!.deaths, minuteBucket: 2, lastCallAt: 0, alive: false };
    expect(decideTrigger(mem, alive, 60_000, 90)).toBe("respawn");
    // Still dead, or was alive already: nothing
    expect(decideTrigger({ ...mem, alive: true }, alive, 60_000, 90)).toBeNull();
    expect(decideTrigger(mem, normalize(rawGame({ alive: false })), 60_000, 90)).toBeNull();
    // Off in settings
    expect(decideTrigger(mem, alive, 60_000, 90, { hero: true, death: true, periodic: true, enemies: true, respawn: false })).toBeNull();
  });
});

describe("purchase detection", () => {
  it("finds new items by count and ignores consumables", () => {
    expect(newItems(["bracer"], ["bracer", "bracer", "tango", "tpscroll"])).toEqual(["bracer"]);
    expect(newItems(["blink", "magic_wand"], ["magic_wand", "blink"])).toEqual([]);
  });

  it("knows boots upgrades", () => {
    expect(isBootsUpgrade("phase_boots")).toBe(true);
    expect(isBootsUpgrade("power_treads")).toBe(true);
    expect(isBootsUpgrade("boots")).toBe(false);
    expect(isBootsUpgrade("blink")).toBe(false);
  });

  it("treats a recommended item, or a part of one, as followed", () => {
    expect(classifyPurchase("black_king_bar", [rec("black_king_bar")], 900)).toMatchObject({ followed: true, replaced: [] });
    expect(classifyPurchase("ogre_axe", [rec("black_king_bar")], 900)).toMatchObject({ followed: true });
  });

  it("drops the similar-priced recommendation an off-plan item replaced", () => {
    const recs = [rec("tpscroll", "rule"), rec("maelstrom"), rec("black_king_bar")];
    const p = classifyPurchase("bfury", recs, 900)!;
    expect(p.followed).toBe(false);
    expect(p.replaced).toEqual(["maelstrom"]);
  });

  it("settles the boots slot with any boots upgrade, and ignores loose parts", () => {
    expect(classifyPurchase("phase_boots", [rec("power_treads"), rec("blink")], 600)).toMatchObject({ followed: false, replaced: ["power_treads"] });
    expect(classifyPurchase("demon_edge", [rec("blink")], 600)).toBeNull();
  });

  it("counts the TP slot as owned, even when the AI suggests a TP", () => {
    const s = normalize(rawGame({ items: ["quelling_blade"], tp: true }));
    const recs = recommendItems(s, { role: "core", popularity: null, enemies: [], aiItems: [{ item: "tpscroll", reason: "carry TP" }, { item: "quelling_blade", reason: "" }, { item: "magic_wand", reason: "" }] });
    expect(recs.map((r) => r.key)).not.toContain("tpscroll");
    expect(recs.map((r) => r.key)).not.toContain("quelling_blade");
    expect(recs.map((r) => r.key)).toContain("magic_wand");
  });

  it("suggests what a bought part builds into, preferring the hero's popular items", () => {
    // Ogre Axe bought while the list was about Blink and Maelstrom: BKB isn't suggested for this phase, but it's
    // the hero's popular late item that uses Ogre Axe, so it comes in as "builds from your Ogre Axe"
    const s = normalize(rawGame({ items: ["ogre_axe"], gold: 0 }));
    const recs = recommendItems(s, { role: "core", popularity: { start: [], early: ["blink"], mid: ["maelstrom"], late: ["black_king_bar"] }, enemies: [], aiItems: [] });
    const bkb = recs.find((r) => r.key === "black_king_bar");
    expect(bkb?.reason).toMatch(/Builds from your Ogre Axe/);
    // Without popularity data it still finds something Ogre Axe builds into
    const any = recommendItems(s, { role: "core", popularity: null, enemies: [], aiItems: [] });
    expect(any.some((r) => getItem(r.key)?.components.includes("ogre_axe"))).toBe(true);
  });

  it("keeps items riding the courier counted as owned", () => {
    const s = normalize(rawGame({ items: ["power_treads"] }));
    const recs = recommendItems(s, { role: "core", popularity: { start: [], early: ["blink", "black_king_bar"], mid: [], late: [] }, enemies: [], aiItems: [], inTransit: ["blink"] });
    expect(recs.map((r) => r.key)).not.toContain("blink");
  });

  it("stops suggesting other boots once upgraded boots are owned", () => {
    const s = normalize(rawGame({ items: ["phase_boots"] }));
    const recs = recommendItems(s, { role: "core", popularity: { start: [], early: ["power_treads", "blink"], mid: [], late: [] }, enemies: [], aiItems: [] });
    expect(recs.map((r) => r.key)).not.toContain("power_treads");
    const skipped = recommendItems(s, { role: "core", popularity: { start: [], early: ["blink", "black_king_bar"], mid: [], late: [] }, enemies: [], aiItems: [], skipped: ["blink"] });
    expect(skipped.map((r) => r.key)).not.toContain("blink");
  });

  it("detects an off-plan buy in a running game, drops what it replaced and asks the AI again", async () => {
    const asked: unknown[] = [];
    const advisor = new Advisor({ runtime: rt(true), call: async (p) => { asked.push(p); return { summary: "ok", danger: "low", next_items: [], skill_priority: [], tips: [] }; } });
    const state = new CoachState(advisor, async () => ({ start: [], early: ["maelstrom", "black_king_bar"], mid: [], late: [] }), undefined as never, new SettingsStore(null), async () => null, async () => null, async () => null);
    state.ingest(rawGame({ items: ["power_treads"], gold: 0 }));
    await new Promise((r) => setTimeout(r, 0)); // popularity + opening AI call
    state.ingest(rawGame({ items: ["power_treads"], gold: 0 }));
    expect(state.report!.items.map((i) => i.key)).toContain("maelstrom");
    // Courier delivers a Battle Fury: the bag goes treads -> treads + bfury
    asked.length = 0;
    (advisor as unknown as { mem: { lastCallAt: number } }).mem.lastCallAt = 0; // past the 20s gap
    state.ingest(rawGame({ items: ["power_treads", "bfury"], gold: 0 }));
    expect(state.purchases.at(-1)).toMatchObject({ item: "bfury", followed: false, replaced: ["maelstrom"] });
    expect(state.report!.items.map((i) => i.key)).not.toContain("maelstrom");
    await new Promise((r) => setTimeout(r, 0));
    expect(asked).toHaveLength(1);
    expect((asked[0] as { off_plan_purchase?: unknown[] }).off_plan_purchase).toEqual([{ bought: "bfury", name: "Battle Fury", instead_of: ["maelstrom"] }]);
    // The item leaving with the courier and coming back isn't a second purchase
    state.ingest(rawGame({ items: ["power_treads"], gold: 0 }));
    state.ingest(rawGame({ items: ["power_treads", "bfury"], gold: 0 }));
    expect(state.purchases.filter((p) => p.item === "bfury")).toHaveLength(1);
  });
});
