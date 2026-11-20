import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { Advisor } from "../src/ai/advisor.js";
import { CoachState } from "../src/state.js";
import { createApp } from "../src/app.js";
import { TemplateBank } from "../src/vision/matcher.js";
import { MIN_STREAK } from "../src/vision/detector.js";
import { rawGame, rt } from "./fixtures.js";
import { captured, portrait } from "./vision-fixtures.js";

// Real hero keys so getHero() accepts them; synthetic art stands in for the CDN portraits
const ME = "npc_dota_hero_juggernaut";
const ALLIES = [ME, "npc_dota_hero_crystal_maiden", "npc_dota_hero_axe", "npc_dota_hero_lion", "npc_dota_hero_puck"];
const FOES = ["npc_dota_hero_riki", "npc_dota_hero_lina", "npc_dota_hero_sven", "npc_dota_hero_zuus", "npc_dota_hero_pudge"];
const ART = new Map([...ALLIES, ...FOES, "npc_dota_hero_slark", "npc_dota_hero_tinker"].map((h, i) => [h, portrait(1000 + i)]));
const bank = new TemplateBank();
for (const [h, img] of ART) bank.add(h, img);

const b64Frame = (list: string[], seed: number) =>
  list.map((h, i) => Buffer.from(captured(ART.get(h)!, seed * 10 + i).data).toString("base64"));

function newState() {
  const advisor = new Advisor({ runtime: rt(false), call: null });
  return { state: new CoachState(advisor, async () => null, async () => ({ bank })), advisor };
}

describe("GSI lineup", () => {
  it("fills enemies from draft data when the game sends it", () => {
    const { state } = newState();
    const raw = rawGame();
    raw.draft = { team3: { pick0_id: 32, pick0_class: "riki", pick1_id: 25 }, team2: { pick0_id: 8 } };
    state.ingest(raw);
    expect(state.enemies).toEqual(["npc_dota_hero_riki", "npc_dota_hero_lina"]);
    expect(state.enemySource).toBe("gsi");
    expect(state.visionWanted()).toBe(false);
  });

  it("never overrides a manual list, and clearing hands control back", () => {
    const { state } = newState();
    state.ingest(rawGame());
    state.setEnemies(["npc_dota_hero_sven"]);
    const raw = rawGame();
    raw.draft = { team3: { pick0_id: 32 } };
    state.ingest(raw);
    expect(state.enemies).toEqual(["npc_dota_hero_sven"]);
    expect(state.enemySource).toBe("manual");

    state.setEnemies([]);
    expect(state.enemySource).toBe("none");
    state.ingest(raw);
    expect(state.enemies).toEqual(["npc_dota_hero_riki"]);
  });
});

describe("vision over HTTP", () => {
  let base = "";
  let close: () => Promise<void>;
  let state: CoachState;

  beforeAll(async () => {
    const s = newState();
    state = s.state;
    const { server, wss } = createApp(state, s.advisor, "test-token");
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((r) => { wss.close(); server.close(() => r()); });
  });
  afterAll(() => close());

  const post = (body: unknown) =>
    fetch(`${base}/api/vision/topbar`, { method: "POST", body: JSON.stringify(body) });

  it("rejects malformed captures", async () => {
    expect((await post({ w: 48, h: 27, radiant: [], dire: [] })).status).toBe(400);
    expect((await post({ w: 4000, h: 27 })).status).toBe(400);
    expect((await post({ w: 48, h: 27, radiant: Array(5).fill("AAAA"), dire: Array(5).fill("AAAA") })).status).toBe(400);
  });

  it("does nothing before a game (not wanted)", async () => {
    const st = await (await fetch(`${base}/api/vision/status`)).json();
    expect(st.wanted).toBe(false);
  });

  it("detects the enemy lineup after a few frames and then stops asking", async () => {
    await fetch(`${base}/gsi`, { method: "POST", body: JSON.stringify(rawGame({ matchId: "777" })) });
    expect((await (await fetch(`${base}/api/vision/status`)).json()).wanted).toBe(true);

    let last: any;
    for (let f = 1; f <= MIN_STREAK; f++) {
      last = await (await post({ w: 48, h: 27, radiant: b64Frame(ALLIES, f), dire: b64Frame(FOES, f) })).json();
    }
    expect(last.calibration).toBe("ok");
    expect(last.enemies).toEqual(FOES);
    expect(last.wanted).toBe(false);
    expect(state.enemySource).toBe("vision");
    expect(state.report?.items.some((i) => i.reason.includes("Riki"))).toBe(true);

    const st = await (await fetch(`${base}/api/state`)).json();
    expect(st.enemySource).toBe("vision");
    expect(st.detection.calibration).toBe("ok");
  });

  it("resets on a new match", async () => {
    await fetch(`${base}/gsi`, { method: "POST", body: JSON.stringify(rawGame({ matchId: "778" })) });
    expect(state.enemies).toEqual([]);
    expect(state.enemySource).toBe("none");
  });
});

describe("Learning from your corrections", () => {
  it("teaches the matcher a portrait when you replace a wrong hero", async () => {
    const own = new TemplateBank();
    for (const [h, img] of ART) own.add(h, img);
    const advisor = new Advisor({ runtime: rt(false), call: null });
    const state = new CoachState(advisor, async () => null, async () => ({ bank: own }));
    const learned: string[] = [];
    state.persistLearned = async (hero) => void learned.push(hero);
    state.ingest(rawGame({ matchId: "900" }));
    // Slot 3 shows Slark's art; you know it's really Tinker (say, a persona the matcher mistook)
    const seen = [FOES[0], FOES[1], "npc_dota_hero_slark", FOES[3], FOES[4]];
    const frames = (f: number) => ({
      radiant: ALLIES.map((h, i) => captured(ART.get(h)!, f * 10 + i)),
      dire: seen.map((h, i) => captured(ART.get(h)!, f * 10 + i)),
    });
    for (let f = 1; f <= MIN_STREAK; f++) await state.ingestVision(frames(f));
    expect(state.enemies).toContain("npc_dota_hero_slark");

    const without = state.enemies.filter((h) => h !== "npc_dota_hero_slark");
    state.setEnemies(without);
    expect(learned).toEqual([]);
    state.setEnemies([...without, "npc_dota_hero_tinker"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(learned).toEqual(["npc_dota_hero_tinker"]);
    expect(state.enemySource).toBe("manual");
  });
});
