import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SAMPLE_LOBBY_LINE_IP,
  SAMPLE_LOBBY_LINE_SDR,
  SAMPLE_LOOPBACK_LINE,
  accountIdFromSteamId64,
  parseLatestLobby,
  parseLobbyLine,
} from "../src/matchlog/parser.js";
import { ServerLogWatcher, candidateLogPaths, parseLibraryFolders } from "../src/matchlog/watcher.js";
import { parsePlayerSummary, rankLabel, type PlayerSummary } from "../src/data/opendota.js";
import { Advisor } from "../src/ai/advisor.js";
import { CoachState } from "../src/state.js";
import { rawGame, rt } from "./fixtures.js";

describe("server_log lobby parser", () => {
  it("reads an SDR matchmaking line: lobby, mode, 10 players split 0-4 Radiant / 5-9 Dire, parties", () => {
    const l = parseLobbyLine(SAMPLE_LOBBY_LINE_SDR)!;
    expect(l.lobbyId).toBe("27612345678901234");
    expect(l.gameMode).toBe("DOTA_GAMEMODE_ALL_DRAFT");
    expect(l.server).toEqual({ kind: "sdr", steamId: "2583351297" });
    expect(l.players).toHaveLength(10);
    expect(l.players[0]).toEqual({ slot: 0, accountId: 100000001, team: "radiant" });
    expect(l.players[9]).toEqual({ slot: 9, accountId: 100000010, team: "dire" });
    expect(l.players.filter((p) => p.team === "radiant")).toHaveLength(5);
    expect(l.parties).toEqual([[100000001, 100000002]]);
    expect(new Date(l.at!).getFullYear()).toBe(2022);
  });

  it("reads the older IP:port form", () => {
    const l = parseLobbyLine(SAMPLE_LOBBY_LINE_IP)!;
    expect(l.server).toEqual({ kind: "ip", address: "155.133.246.35:27031" });
    expect(l.gameMode).toBe("DOTA_GAMEMODE_AP");
    expect(l.parties).toEqual([]);
  });

  it("ignores loopback lines, noise and half-written lines", () => {
    expect(parseLobbyLine(SAMPLE_LOOPBACK_LINE)).toBeNull();
    expect(parseLobbyLine("")).toBeNull();
    expect(parseLobbyLine("random text [U:1:123]")).toBeNull();
    expect(parseLobbyLine(SAMPLE_LOBBY_LINE_SDR.slice(0, 120))).toBeNull();
  });

  it("keeps coach/extra slots without a side", () => {
    const l = parseLobbyLine(SAMPLE_LOBBY_LINE_SDR.replace("9:[U:1:100000010])", "9:[U:1:100000010] 10:[U:1:42])"))!;
    expect(l.players.at(-1)).toEqual({ slot: 10, accountId: 42, team: null });
  });

  it("returns the newest lobby from a CRLF log with older entries", () => {
    const text = [SAMPLE_LOOPBACK_LINE, SAMPLE_LOBBY_LINE_IP, SAMPLE_LOBBY_LINE_SDR, SAMPLE_LOOPBACK_LINE, ""].join("\r\n");
    expect(parseLatestLobby(text)?.lobbyId).toBe("27612345678901234");
    expect(parseLatestLobby(SAMPLE_LOOPBACK_LINE)).toBeNull();
  });

  it("converts GSI SteamID64 to the 32-bit account ID", () => {
    expect(accountIdFromSteamId64("76561198060265729")).toBe(100000001);
    expect(accountIdFromSteamId64(undefined)).toBeNull();
    expect(accountIdFromSteamId64("abc")).toBeNull();
    expect(accountIdFromSteamId64("76561197960265728")).toBeNull();
  });
});

describe("server_log path discovery", () => {
  it("reads library folders from libraryfolders.vdf", () => {
    const vdf = `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}`;
    expect(parseLibraryFolders(vdf)).toEqual(["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]);
  });

  it("lists every library's dota folder once", () => {
    const root = path.join("X", "Steam");
    const list = candidateLogPaths([root], () => `"path" "${path.join("Y", "Lib").replace(/\\/g, "\\\\")}" "path" "${root.replace(/\\/g, "\\\\")}"`);
    expect(list).toEqual([
      path.join(root, "steamapps", "common", "dota 2 beta", "game", "dota", "server_log.txt"),
      path.join("Y", "Lib", "steamapps", "common", "dota 2 beta", "game", "dota", "server_log.txt"),
    ]);
  });

  it("watcher reads a lobby already in the file and reports a missing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-log-"));
    const file = path.join(dir, "server_log.txt");
    fs.writeFileSync(file, `${SAMPLE_LOOPBACK_LINE}\n${SAMPLE_LOBBY_LINE_SDR}\n`);
    const got: string[] = [];
    const w = new ServerLogWatcher((l) => got.push(l.lobbyId), 50);
    w.start(file);
    expect(got).toEqual(["27612345678901234"]);
    expect(w.status.exists).toBe(true);
    w.start(path.join(dir, "missing.txt"));
    expect(w.status.exists).toBe(false);
    expect(w.status.error).toMatch(/not found/);
    w.stop();
  });
});

describe("OpenDota player summary", () => {
  it("labels rank tiers", () => {
    expect(rankLabel(54)).toBe("Legend 4");
    expect(rankLabel(80, 312)).toBe("Immortal #312");
    expect(rankLabel(null)).toBeNull();
    expect(rankLabel(95)).toBeNull();
  });

  it("builds win rate and top heroes from public data", () => {
    const s = parsePlayerSummary(
      7,
      { profile: { personaname: "Foe" }, rank_tier: 61 },
      { win: 12, lose: 8 },
      [{ hero_id: 1, games: 2, win: 1 }, { hero_id: "8", games: 9, win: 6 }, { hero_id: 2, games: 0, win: 0 }, { hero_id: 5, games: 4, win: 1 }, { hero_id: 6, games: 3, win: 3 }],
    );
    expect(s.name).toBe("Foe");
    expect(s.rank).toBe("Ancient 1");
    expect(s.recent).toEqual({ games: 20, wins: 12, losses: 8, winRate: 0.6 });
    expect(s.topHeroes.map((h) => h.heroId)).toEqual([8, 5, 6]);
    expect(s.isPrivate).toBe(false);
  });

  it("flags private / unknown profiles", () => {
    expect(parsePlayerSummary(7, { profile: null }, null, null).isPrivate).toBe(true);
    expect(parsePlayerSummary(7, { profile: { personaname: "x" }, rank_tier: 33 }, { win: 0, lose: 0 }, []).isPrivate).toBe(true);
  });
});

describe("CoachState lobby", () => {
  const summary = (accountId: number): PlayerSummary =>
    parsePlayerSummary(accountId, { profile: { personaname: `p${accountId}` }, rank_tier: 45 }, { win: 5, lose: 5 }, [{ hero_id: 1, games: 3, win: 2 }]);

  function setup() {
    const requested: number[] = [];
    const state = new CoachState(new Advisor({ runtime: rt(false), call: null }), async () => null, undefined, undefined, async (id) => {
      requested.push(id);
      return summary(id);
    });
    return { state, requested };
  }
  const lobby = () => ({ ...parseLobbyLine(SAMPLE_LOBBY_LINE_SDR)!, at: Date.now() });

  it("splits allies/enemies by our account ID from GSI and loads enemies first", async () => {
    const { state, requested } = setup();
    const raw = rawGame();
    raw.player!.team_name = "radiant"; // GSI side disagrees on purpose: the lobby slot wins
    raw.player!.steamid = "76561198060265734"; // account 100000006 = slot 5 (Dire)
    state.ingest(raw);
    state.ingestLobby(lobby());
    await new Promise((r) => setTimeout(r, 0));
    const m = state.matchInfo()!;
    expect(m.myTeam).toBe("dire");
    expect(m.enemies.map((p) => p.accountId)).toEqual([100000001, 100000002, 100000003, 100000004, 100000005]);
    expect(m.allies.find((p) => p.isMe)?.accountId).toBe(100000006);
    expect(requested.slice(0, 5)).toEqual([100000001, 100000002, 100000003, 100000004, 100000005]);
    expect(m.enemies[0]).toMatchObject({ status: "ok", party: 0, stats: { name: "p100000001", rank: "Archon 5" } });
    expect(m.enemies[0].stats!.topHeroes[0].name).toBe("npc_dota_hero_antimage");
  });

  it("falls back to the GSI team, ignores stale lobbies and leaves the enemy hero list alone", async () => {
    const { state } = setup();
    state.ingest(rawGame());
    state.setEnemies(["npc_dota_hero_axe"]);
    state.ingestLobby({ ...lobby(), at: Date.now() - 4 * 3600_000 });
    expect(state.matchInfo()).toBeNull();
    state.ingestLobby(lobby());
    expect(state.matchInfo()!.myTeam).toBe("radiant");
    expect(state.matchInfo()!.enemies[0].slot).toBe(5);
    expect(state.enemies).toEqual(["npc_dota_hero_axe"]);
    state.settings.update({ matchInfo: { enabled: false } });
    expect(state.matchInfo()).toBeNull();
  });
});
