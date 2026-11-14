import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Advisor } from "../src/ai/advisor.js";
import { CoachState } from "../src/state.js";
import { createApp } from "../src/app.js";
import { SettingsStore, defaultSettings, mergeSettings } from "../src/settings.js";
import { normalize } from "../src/gsi/normalize.js";
import { buildReport } from "../src/engine/index.js";
import { rawGame, rt } from "./fixtures.js";

describe("mergeSettings", () => {
  it("clamps numbers, ignores unknown keys and invalid values", () => {
    const s = mergeSettings(defaultSettings(), {
      ai: { model: "gpt-9", effort: "max", autoIntervalSec: 5, triggers: { death: false, bogus: true } },
      coach: { lowHpPct: 500, goldAlert: "lots", timers: { stack: false } },
      overlay: { opacity: 0.1, scale: 1.234 },
      hacker: { evil: true },
    });
    expect(s.ai.model).toBe(defaultSettings().ai.model); // unknown model rejected
    expect(s.ai.effort).toBe(defaultSettings().ai.effort); // max is not offered
    expect(s.ai.autoIntervalSec).toBe(30);
    expect(s.ai.triggers).toEqual({ hero: true, death: false, periodic: true, enemies: true });
    expect(s.coach.lowHpPct).toBe(60);
    expect(s.coach.goldAlert).toBe(2000);
    expect(s.coach.timers.stack).toBe(false);
    expect(s.coach.timers.bounty).toBe(true);
    expect(s.overlay.opacity).toBe(0.3);
    expect(s.overlay.scale).toBe(1.25);
    expect(s.overlay.sound).toBe(true);
    expect(s.overlay.soundVolume).toBe(0.6);
    const muted = mergeSettings(s, { overlay: { sound: false, soundVolume: 3 } });
    expect(muted.overlay.sound).toBe(false);
    expect(muted.overlay.soundVolume).toBe(1);
    expect(mergeSettings(s, { overlay: { sound: "yes" } }).overlay.sound).toBe(true);
    expect((s as any).hacker).toBeUndefined();
  });
});

describe("SettingsStore", () => {
  it("persists settings, keeps the key in a separate 600 file and never exposes it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-settings-"));
    const a = new SettingsStore(dir);
    a.update({ coach: { lowHpPct: 40 } });
    a.setApiKey("sk-ant-test-0123456789abcdefWXYZ");
    const b = new SettingsStore(dir);
    expect(b.get().coach.lowHpPct).toBe(40);
    expect(b.keyStatus()).toEqual({ source: "settings", last4: "WXYZ" });
    expect(fs.readFileSync(path.join(dir, "settings.json"), "utf8")).not.toContain("sk-ant");
    if (process.platform !== "win32") expect(fs.statSync(path.join(dir, "secrets.json")).mode & 0o777).toBe(0o600);
    b.setApiKey(null);
    expect(new SettingsStore(dir).keyStatus().source).not.toBe("settings");
  });
});

describe("engine uses settings", () => {
  it("applies the HP threshold, gold alert and hidden timers", () => {
    const s = normalize(rawGame({ hp: 35, gold: 1500 }));
    const base = { rolePref: "auto" as const, popularity: null, enemies: [], ai: null };
    const def = buildReport(s, base);
    expect(def.alerts.find((a) => a.id === "mid-hp")).toBeDefined();

    const custom = buildReport(s, { ...base, prefs: { lowHpPct: 40, goldAlert: 1000, timers: { stack: false, power: false } } });
    expect(custom.alerts.find((a) => a.id === "low-hp")).toBeDefined();
    expect(custom.alerts.find((a) => a.id === "gold")).toBeDefined();
    expect(custom.timers.map((t) => t.id)).not.toContain("stack");
    expect(custom.timers.map((t) => t.id)).not.toContain("power");
  });

  it("default role and detection toggle apply live", () => {
    const settings = new SettingsStore(null);
    const state = new CoachState(new Advisor({ runtime: rt(false), call: null }), async () => null, undefined, settings);
    state.ingest(rawGame());
    expect(state.visionWanted()).toBe(true);
    settings.update({ detection: { enabled: false }, coach: { defaultRole: "support" } });
    expect(state.visionWanted()).toBe(false);
    expect(state.rolePref).toBe("support");
    expect(state.report?.role).toBe("support");
  });
});

describe("advisor triggers follow settings", () => {
  it("skips disabled triggers but still tracks the match", async () => {
    let calls = 0;
    const triggers = { hero: false, death: true, periodic: false, enemies: true };
    let now = 1_000_000;
    const a = new Advisor({
      runtime: rt(true, { triggers }),
      call: async () => { calls++; return { summary: "", danger: "low", next_items: [], skill_priority: [], tips: [] }; },
      now: () => now,
    });
    const s0 = normalize(rawGame({ deaths: 0, clock: 600 }));
    const rep = (s: ReturnType<typeof normalize>) => buildReport(s, { rolePref: "auto", popularity: null, enemies: [], ai: null });
    expect(a.onSnapshot(s0, rep(s0), [])).toBeNull(); // hero trigger off
    now += 60_000;
    const s1 = normalize(rawGame({ deaths: 1, clock: 900 }));
    await a.onSnapshot(s1, rep(s1), []); // death still fires
    expect(calls).toBe(1);
    expect(a.status().advice?.reason).toBe("death");
  });
});

describe("settings API", () => {
  let base = "";
  let close: () => Promise<void>;
  let settings: SettingsStore;
  let tested: { model: string; key: string | null } | null = null;

  beforeAll(async () => {
    settings = new SettingsStore(null);
    const advisor = new Advisor({ runtime: rt(false), call: null });
    const state = new CoachState(advisor, async () => null, undefined, settings);
    const { server, wss } = createApp(state, advisor, "t", {
      testAi: async (model, key) => { tested = { model, key }; return { ok: true, model }; },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((r) => { wss.close(); server.close(() => r()); });
  });
  afterAll(() => close());

  const call = (method: string, p: string, body?: unknown) =>
    fetch(`${base}${p}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  it("reads settings with options and edit permission", async () => {
    const v = await (await call("GET", "/api/settings")).json();
    expect(v.canEdit).toBe(true);
    expect(v.options.models.length).toBe(3);
    expect(v.apiKey.source).toBeDefined();
  });

  it("patches, validates and resets", async () => {
    const v = await (await call("PATCH", "/api/settings", { overlay: { opacity: 0.6 }, coach: { lowHpPct: 999 } })).json();
    expect(v.settings.overlay.opacity).toBe(0.6);
    expect(v.settings.coach.lowHpPct).toBe(60);
    const r = await (await call("POST", "/api/settings/reset")).json();
    expect(r.settings.overlay.opacity).toBe(defaultSettings().overlay.opacity);
  });

  it("stores an API key without ever echoing it, and tests it", async () => {
    expect((await call("PUT", "/api/settings/api-key", { key: "short" })).status).toBe(400);
    const res = await call("PUT", "/api/settings/api-key", { key: "sk-ant-api03-abcdefghijklmnop1234" });
    const text = await res.text();
    expect(text).not.toContain("abcdefghijklmnop");
    expect(JSON.parse(text).apiKey).toEqual({ source: "settings", last4: "1234" });
    const t = await (await call("POST", "/api/settings/test-ai")).json();
    expect(t.ok).toBe(true);
    expect(tested?.key).toBe("sk-ant-api03-abcdefghijklmnop1234");
    const d = await (await call("DELETE", "/api/settings/api-key")).json();
    expect(d.apiKey.source).not.toBe("settings");
  });

  it("state over the API carries settings but never the key", async () => {
    await call("PUT", "/api/settings/api-key", { key: "sk-ant-api03-zzzzzzzzzzzzzzzz9999" });
    const st = await (await call("GET", "/api/state")).text();
    expect(st).not.toContain("zzzzzzzz");
    expect(JSON.parse(st).settings.overlay).toBeDefined();
  });
});
