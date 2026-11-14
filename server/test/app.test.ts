import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { Advisor } from "../src/ai/advisor.js";
import { CoachState } from "../src/state.js";
import { createApp } from "../src/app.js";
import { rawGame } from "./fixtures.js";

let base = "";
let close: () => Promise<void>;
let state: CoachState;

beforeAll(async () => {
  const advisor = new Advisor({ enabled: false, model: "m", minIntervalSec: 90, call: null });
  state = new CoachState(advisor, async () => null);
  const { server, wss } = createApp(state, advisor, "test-token");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((r) => { wss.close(); server.close(() => r()); });
});
afterAll(() => close());

describe("HTTP", () => {
  it("rejects GSI with wrong token", async () => {
    const res = await fetch(`${base}/gsi`, { method: "POST", body: JSON.stringify({ ...rawGame(), auth: { token: "nope" } }) });
    expect(res.status).toBe(401);
  });

  it("rejects invalid json", async () => {
    const res = await fetch(`${base}/gsi`, { method: "POST", body: "{oops" });
    expect(res.status).toBe(400);
  });

  it("ingests GSI and exposes state", async () => {
    const res = await fetch(`${base}/gsi`, { method: "POST", body: JSON.stringify(rawGame()) });
    expect(res.status).toBe(200);
    const st = await (await fetch(`${base}/api/state`)).json();
    expect(st.snapshot.hero.name).toBe("npc_dota_hero_juggernaut");
    expect(st.heroInfo.localizedName).toBe("Juggernaut");
    expect(st.report.items.length).toBeGreaterThan(0);
    expect(st.ai.enabled).toBe(false);
  });

  it("validates and stores enemies (dedup, unknown dropped)", async () => {
    const res = await fetch(`${base}/api/enemies`, {
      method: "POST",
      body: JSON.stringify({ heroes: ["npc_dota_hero_riki", "npc_dota_hero_riki", "npc_dota_hero_fake"] }),
    });
    expect((await res.json()).enemies).toEqual(["npc_dota_hero_riki"]);
    expect(state.report?.items.some((i) => i.source === "counter")).toBe(true);
  });

  it("resets enemies on a new match", async () => {
    await fetch(`${base}/gsi`, { method: "POST", body: JSON.stringify(rawGame({ matchId: "456" })) });
    expect(state.enemies).toEqual([]);
  });

  it("returns 409 for ask when AI disabled", async () => {
    const res = await fetch(`${base}/api/ask`, { method: "POST", body: "{}" });
    expect(res.status).toBe(409);
  });

  it("lists heroes", async () => {
    const heroes = await (await fetch(`${base}/api/heroes`)).json();
    expect(heroes.length).toBeGreaterThan(100);
  });

  it("pushes state over websocket", async () => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
    const msg = await new Promise<any>((resolve) => ws.once("message", (d) => resolve(JSON.parse(String(d)))));
    ws.close();
    expect(msg.type).toBe("state");
    expect(msg.data.snapshot.hero.name).toBe("npc_dota_hero_juggernaut");
  });
});
