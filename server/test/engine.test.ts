import { describe, expect, it } from "vitest";
import { normalize } from "../src/gsi/normalize.js";
import { getItem, remainingCost } from "../src/data/constants.js";
import { parsePopularity } from "../src/data/opendota.js";
import { pointsEarned, recommendSkill, unspentPoints } from "../src/engine/skills.js";
import { recommendItems, inferRole, phaseOf } from "../src/engine/items.js";
import { COUNTER_RULES, matchCounters } from "../src/engine/counters.js";
import { buildTimers, nextOccurrence, PERIODIC } from "../src/engine/timers.js";
import { buildReport } from "../src/engine/index.js";
import { rawGame } from "./fixtures.js";

describe("normalize", () => {
  it("strips item_ prefix, drops empty slots, splits backpack", () => {
    const s = normalize(rawGame({ items: ["blink", "", "", "", "", "", "magic_wand"] }));
    expect(s.items.inventory.map((i) => i.name)).toEqual(["blink"]);
    expect(s.items.backpack.map((i) => i.name)).toEqual(["magic_wand"]);
    expect(s.items.teleport?.name).toBe("tpscroll");
    expect(s.hero?.name).toBe("npc_dota_hero_juggernaut");
    expect(s.inProgress).toBe(true);
  });

  it("treats missing hero (menu / spectating w/o hero) as null", () => {
    const s = normalize({ map: { game_state: "DOTA_GAMERULES_STATE_HERO_SELECTION" } });
    expect(s.hero).toBeNull();
    expect(s.player).toBeNull();
  });
});

describe("skills", () => {
  it("skips levels that grant no point", () => {
    expect(pointsEarned(16)).toBe(16);
    expect(pointsEarned(17)).toBe(16);
    expect(pointsEarned(25)).toBe(19);
  });

  it("detects unspent points and recommends ultimate at 6", () => {
    const s = normalize(rawGame({ level: 6, abilityLevels: [3, 1, 1, 0] }));
    expect(unspentPoints(s)).toBe(1);
    const r = recommendSkill(s, null);
    expect(r.next?.key).toBe("juggernaut_omni_slash");
  });

  it("follows AI priority and respects the level cap", () => {
    // Level 5: basic cap is 3. Blade Fury is already 3, so the next priority is picked
    const s = normalize(rawGame({ level: 5, abilityLevels: [3, 1, 0, 0] }));
    const r = recommendSkill(s, ["juggernaut_blade_fury", "juggernaut_blade_dance"]);
    expect(r.prioritySource).toBe("ai");
    expect(r.next?.key).toBe("juggernaut_blade_dance");
  });

  it("asks for a talent at 10 when none taken", () => {
    const s = normalize(rawGame({ level: 10, abilityLevels: [4, 1, 3, 1] }));
    const r = recommendSkill(s, null);
    expect(r.next?.kind).toBe("talent");
    expect(r.next?.options).toHaveLength(2);
  });

  it("returns nothing when all points spent", () => {
    const s = normalize(rawGame({ level: 7, abilityLevels: [4, 1, 1, 1] }));
    expect(recommendSkill(s, null).next).toBeNull();
  });
});

describe("items", () => {
  it("subtracts owned components from remaining cost", () => {
    const bkb = getItem("black_king_bar")!;
    const ogre = getItem("ogre_axe")!;
    expect(remainingCost("black_king_bar", ["ogre_axe"])).toBe(bkb.cost - ogre.cost);
  });

  it("puts TP first when missing", () => {
    const s = normalize(rawGame({ tp: false }));
    const recs = recommendItems(s, { role: "core", popularity: null, enemies: [], aiItems: [] });
    expect(recs[0].key).toBe("tpscroll");
  });

  it("does not recommend items already built (or their components)", () => {
    const s = normalize(rawGame({ items: ["power_treads", "black_king_bar"] }));
    const recs = recommendItems(s, { role: "core", popularity: null, enemies: ["npc_dota_hero_lion"], aiItems: [] });
    const keys = recs.map((r) => r.key);
    expect(keys).not.toContain("black_king_bar");
    expect(keys).not.toContain("power_treads");
    expect(keys).not.toContain("boots");
  });

  it("adds counters with hero names in the reason", () => {
    const s = normalize(rawGame());
    const recs = recommendItems(s, { role: "core", popularity: null, enemies: ["npc_dota_hero_riki"], aiItems: [] });
    const dust = recs.find((r) => r.key === "dust");
    expect(dust?.source).toBe("counter");
    expect(dust?.reason).toContain("Riki");
  });

  it("uses OpenDota popularity by phase", () => {
    const pop = parsePopularity({
      early_game_items: { [getItem("phase_boots")!.id]: 900, [getItem("magic_wand")!.id]: 800 },
      mid_game_items: { [getItem("sange_and_yasha")!.id]: 500 },
    });
    expect(pop.early[0]).toBe("phase_boots");
    const s = normalize(rawGame({ clock: 300, items: [] }));
    const recs = recommendItems(s, { role: "core", popularity: pop, enemies: [], aiItems: [] });
    expect(recs.map((r) => r.key)).toEqual(expect.arrayContaining(["phase_boots", "sange_and_yasha"]));
  });

  it("ranks AI items above meta and drops ones already owned", () => {
    const s = normalize(rawGame());
    const recs = recommendItems(s, {
      role: "core", popularity: null, enemies: [],
      aiItems: [{ item: "magic_wand", reason: "x" }, { item: "basher", reason: "lock" }],
    });
    expect(recs[0].key).toBe("basher");
    expect(recs.map((r) => r.key)).not.toContain("magic_wand");
  });

  it("infers role from hero roles", () => {
    expect(inferRole("npc_dota_hero_crystal_maiden")).toBe("support");
    expect(inferRole("npc_dota_hero_juggernaut")).toBe("core");
    expect(phaseOf(-10)).toBe("pre");
    expect(phaseOf(40 * 60)).toBe("late");
  });
});

describe("static data integrity", () => {
  it("every hardcoded counter item and hero exists in dotaconstants", async () => {
    const { getHero } = await import("../src/data/constants.js");
    for (const r of COUNTER_RULES) {
      for (const k of [...r.core, ...r.support]) expect(getItem(k), `item ${k}`).toBeDefined();
      for (const h of r.heroes) expect(getHero(`npc_dota_hero_${h}`), `hero ${h}`).toBeDefined();
    }
  });

  it("matchCounters sorts by number of matched heroes", () => {
    const m = matchCounters(["npc_dota_hero_lion", "npc_dota_hero_lina", "npc_dota_hero_riki"], "core");
    expect(m[0].rule.id).toBe("magic");
  });
});

describe("timers", () => {
  it("computes next occurrence", () => {
    expect(nextOccurrence(0, 0, 180)).toBe(180);
    expect(nextOccurrence(100, 360, 120)).toBe(360);
    expect(nextOccurrence(370, 360, 120)).toBe(480);
  });

  it("lists timers sorted and includes stack window", () => {
    const s = normalize(rawGame({ clock: 650 }));
    const t = buildTimers(s);
    expect(t.map((x) => x.inSeconds)).toEqual([...t.map((x) => x.inSeconds)].sort((a, b) => a - b));
    expect(t.find((x) => x.id === "stack")?.inSeconds).toBe(3); // 10:50 → 10:53
  });

  it("every periodic timer has sane values", () => {
    for (const p of PERIODIC) expect(p.every).toBeGreaterThan(0);
  });
});

describe("report", () => {
  it("builds a complete report", () => {
    const s = normalize(rawGame({ hp: 20 }));
    const r = buildReport(s, { rolePref: "auto", popularity: null, enemies: [], ai: null });
    expect(r.stats.kda).toBe("2/0/3");
    expect(r.alerts.some((a) => a.id === "low-hp")).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);
  });
});
