import { describe, expect, it } from "vitest";
import { MatchRecorder, type RecordLine } from "../src/matchlog/recorder.js";
import { normalize } from "../src/gsi/normalize.js";
import { Advisor } from "../src/ai/advisor.js";
import { CoachState } from "../src/state.js";
import { rawGame, rt } from "./fixtures.js";

describe("match recorder", () => {
  it("writes a start line, a tick every 30 game seconds, and enemy changes", () => {
    const lines: RecordLine[] = [];
    const rec = new MatchRecorder(null, lines);
    const advisor = new Advisor({ runtime: rt(false), call: null });
    const state = new CoachState(advisor, async () => null);
    state.recorder = rec;
    for (const clock of [100, 110, 131, 140, 165]) {
      state.ingest(rawGame({ matchId: "555", clock }));
    }
    state.setEnemies(["npc_dota_hero_axe"]);
    state.ingest(rawGame({ matchId: "555", clock: 170 }));
    const kinds = lines.map((l) => l.t);
    expect(kinds[0]).toBe("start");
    expect(lines.filter((l) => l.t === "tick").map((l) => l.clock)).toEqual([100, 131, 165]);
    const enemyLines = lines.filter((l) => l.t === "enemies");
    expect(enemyLines.at(-1)).toMatchObject({ list: ["npc_dota_hero_axe"], source: "manual" });
    expect(normalize(rawGame({ matchId: "555" })).matchId).toBe("555");
  });
});
