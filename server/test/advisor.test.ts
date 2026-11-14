import { describe, expect, it, vi } from "vitest";
import { normalize } from "../src/gsi/normalize.js";
import { buildReport } from "../src/engine/index.js";
import { Advisor, decideTrigger, type AdviceCaller } from "../src/ai/advisor.js";
import { buildUserPayload } from "../src/ai/prompt.js";
import { rawGame, rt } from "./fixtures.js";

const report = (s: ReturnType<typeof normalize>) =>
  buildReport(s, { rolePref: "auto", popularity: null, enemies: [], ai: null });

const fakeAdvice = {
  summary: "Hold the lane", danger: "low" as const,
  next_items: [{ item: "black_king_bar", reason: "magic damage" }, { item: "not_a_real_item", reason: "hallucinated" }],
  skill_priority: ["juggernaut_blade_fury"], tips: ["Check wards"],
};

describe("decideTrigger", () => {
  const mem = { key: "123:npc_dota_hero_juggernaut", deaths: 0, minuteBucket: 2, lastCallAt: 0 };

  it("fires on a new hero/match", () => {
    const s = normalize(rawGame({ matchId: "999" }));
    expect(decideTrigger(mem, s, 1_000_000, 90)).toBe("hero");
  });

  it("fires on death, but not twice within 30s", () => {
    const s = normalize(rawGame({ deaths: 1, clock: 700 }));
    expect(decideTrigger(mem, s, 100_000, 90)).toBe("death");
    expect(decideTrigger({ ...mem, lastCallAt: 90_000 }, s, 100_000, 90)).toBeNull();
  });

  it("fires on 5-minute boundary only after the throttle interval", () => {
    const s = normalize(rawGame({ clock: 900 })); // bucket 3
    expect(decideTrigger(mem, s, 100_000, 90)).toBe("minute");
    expect(decideTrigger({ ...mem, lastCallAt: 50_000 }, s, 100_000, 90)).toBeNull();
  });
});

describe("Advisor", () => {
  it("filters hallucinated item keys and records the reason", async () => {
    const call: AdviceCaller = vi.fn(async () => fakeAdvice);
    const a = new Advisor({ runtime: rt(true), call });
    const s = normalize(rawGame());
    await a.onSnapshot(s, report(s), []);
    const adv = a.status().advice!;
    expect(adv.reason).toBe("hero");
    expect(adv.next_items.map((i) => i.item)).toEqual(["black_king_bar"]);
    expect(call).toHaveBeenCalledTimes(1);
    // The same state arriving again does not re-trigger
    expect(a.onSnapshot(s, report(s), [])).toBeNull();
  });

  it("surfaces errors without throwing", async () => {
    const a = new Advisor({ runtime: rt(true), call: async () => { throw new Error("boom"); } });
    const s = normalize(rawGame());
    await a.onSnapshot(s, report(s), []);
    expect(a.status().error).toBe("boom");
    expect(a.status().pending).toBeNull();
  });

  it("rejects manual ask when disabled", async () => {
    const a = new Advisor({ runtime: rt(false), call: null });
    const s = normalize(rawGame());
    await expect(a.ask(s, report(s), [])).rejects.toThrow();
  });

  it("passes the question through to the payload", async () => {
    let seen: any;
    const a = new Advisor({ runtime: rt(true), call: async (p) => { seen = p; return fakeAdvice; } });
    const s = normalize(rawGame());
    await a.ask(s, report(s), ["npc_dota_hero_lion"], "When should I buy BKB?");
    expect(seen.question).toBe("When should I buy BKB?");
    expect(seen.enemies[0].name).toBe("Lion");
    expect(a.status().advice?.question).toBe("When should I buy BKB?");
  });
});

describe("payload", () => {
  it("excludes innate abilities and includes rule engine output", () => {
    const s = normalize(rawGame());
    const p = buildUserPayload(s, report(s), []);
    expect(p.abilities.map((a) => a.key)).toContain("juggernaut_omni_slash");
    expect(p.rule_engine.next_items.length).toBeGreaterThan(0);
    expect(p.clock).toBe("10:00");
  });
});
