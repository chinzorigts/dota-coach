import { describe, expect, it } from "vitest";
import { normalize } from "../src/gsi/normalize.js";
import { parseBenchmarks, parseHeroStats, parseHeroTotals, parseLaneRoles, parseMatchups, parsePlayerSummary } from "../src/data/opendota.js";
import { compareStats, medianOf, percentileOf } from "../src/engine/benchmarks.js";
import { BANDS, bandForMmr, bandForTier, gameResultDelta, rankView } from "../src/engine/rank.js";
import { laneAdjustedFit, matchupAdvantage, positionFit, suggestPicks } from "../src/engine/draft.js";
import { getHero } from "../src/data/constants.js";
import { mergeSettings, defaultSettings, SettingsStore } from "../src/settings.js";
import { CoachState } from "../src/state.js";
import { Advisor } from "../src/ai/advisor.js";
import { rawGame, rt } from "./fixtures.js";

const pts = (vals: number[]) => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99].map((percentile, i) => ({ percentile, value: vals[i] }));
const GPM = pts([433, 491, 552, 603, 644, 684, 723, 765, 823, 870, 948]);

describe("benchmark math", () => {
  it("interpolates percentiles and clamps at the ends", () => {
    expect(percentileOf(GPM, 644)).toBe(50);
    expect(percentileOf(GPM, 664)).toBe(55);
    expect(percentileOf(GPM, 100)).toBe(10);
    expect(percentileOf(GPM, 5000)).toBe(99);
    expect(percentileOf([], 5)).toBeNull();
  });

  it("finds the median, interpolating when 50% is missing", () => {
    expect(medianOf(GPM)).toBe(644);
    expect(medianOf([{ percentile: 0.4, value: 10 }, { percentile: 0.6, value: 20 }])).toBe(15);
  });

  it("parses OpenDota benchmarks", () => {
    const b = parseBenchmarks(8, { hero_id: 8, result: { gold_per_min: GPM, xp_per_min: GPM, kills_per_min: [], last_hits_per_min: [] } });
    expect(b?.goldPerMin).toHaveLength(11);
    expect(parseBenchmarks(8, { error: "x" })).toBeNull();
  });

  it("turns /totals into per-minute averages and ignores tiny samples", () => {
    const raw = [
      { field: "duration", n: 10, sum: 10 * 40 * 60 },
      { field: "kills", n: 10, sum: 80 },
      { field: "deaths", n: 10, sum: 40 },
      { field: "gold_per_min", n: 10, sum: 6000 },
    ];
    const t = parseHeroTotals(1, 8, raw)!;
    expect(t.games).toBe(10);
    expect(t.perMin.kills).toBeCloseTo(80 / 400);
    expect(t.gpm).toBe(600);
    expect(parseHeroTotals(1, 8, [{ field: "duration", n: 2, sum: 4800 }])).toBeNull();
    expect(parseHeroTotals(1, 8, { error: "private" })).toBeNull();
  });
});

describe("compareStats", () => {
  const bench = parseBenchmarks(8, {
    result: { gold_per_min: GPM, xp_per_min: GPM, kills_per_min: pts([0.05, 0.08, 0.1, 0.12, 0.15, 0.17, 0.2, 0.23, 0.27, 0.3, 0.4]), last_hits_per_min: pts([3, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 8.5, 9.5]) },
  });

  it("scales counts to the current minute and gives verdicts after 10:00", () => {
    // 20:00, 2 kills, 60 LH, 450 GPM from the fixture
    const v = compareStats(normalize(rawGame({ clock: 1200 })), bench, null)!;
    expect(v.early).toBe(false);
    const kills = v.rows.find((r) => r.key === "kills")!;
    expect(kills.heroMedian).toBe(3); // 0.15/min x 20
    const lh = v.rows.find((r) => r.key === "lastHits")!;
    expect(lh.heroMedian).toBe(110);
    expect(lh.verdict).toBe("bad");
    const gpm = v.rows.find((r) => r.key === "gpm")!;
    expect(gpm.heroMedian).toBe(644);
    expect(gpm.heroPercentile).toBe(13); // 450 sits between 433 (10%) and 491 (20%)
    // Rows with no reference at all are dropped (deaths needs your own history)
    expect(v.rows.find((r) => r.key === "deaths")).toBeUndefined();
    // KP: (2 kills + 3 assists) / 5 radiant kills
    expect(v.killParticipation).toBe(100);
  });

  it("holds verdicts back early and shows nothing before 2:00", () => {
    expect(compareStats(normalize(rawGame({ clock: 300 })), bench, null)!.rows.every((r) => r.verdict === null)).toBe(true);
    expect(compareStats(normalize(rawGame({ clock: 60 })), bench, null)!.rows).toEqual([]);
  });

  it("uses your own averages for deaths (lower is better)", () => {
    const totals = { accountId: 1, heroId: 8, games: 20, perMin: { kills: 0.2, deaths: 0.25, assists: 0.3, lastHits: 6, denies: 0.3 }, gpm: 600, xpm: 650, fetchedAt: 0 };
    const v = compareStats(normalize(rawGame({ clock: 1200, deaths: 1 })), null, totals)!;
    const deaths = v.rows.find((r) => r.key === "deaths")!;
    expect(deaths.personal).toBe(5);
    expect(deaths.verdict).toBe("good");
    expect(v.personal).toBe("ok");
    expect(v.personalGames).toBe(20);
  });
});

describe("rank", () => {
  it("builds contiguous bands from Herald 1 to Immortal", () => {
    expect(BANDS[0]).toMatchObject({ medal: "Herald", stars: 1, from: 0, tier: 11 });
    for (let i = 1; i < BANDS.length; i++) expect(BANDS[i].from).toBe(BANDS[i - 1].to);
    expect(bandForMmr(770)).toMatchObject({ medal: "Guardian", stars: 1 });
    expect(bandForMmr(4620)).toMatchObject({ medal: "Divine", stars: 1 });
    expect(bandForMmr(6000).medal).toBe("Immortal");
    expect(bandForTier(54)).toMatchObject({ medal: "Legend", stars: 4 });
  });

  it("shows the gap to the next star and the next medal", () => {
    const v = rankView({ mmr: 3500, rankTier: null, perGame: 25 });
    expect(v.label).toBe("Legend 3"); // 3080 + 2*154 = 3388 .. 3542
    expect(v.nextStar).toMatchObject({ label: "Legend 4", mmr: 3542, remaining: 42, wins: 2 });
    expect(v.nextMedal).toMatchObject({ label: "Ancient 1", mmr: 3850, remaining: 350, wins: 14 });
    // In the last star, the next star is the next medal: shown once
    expect(rankView({ mmr: 3800, rankTier: null, perGame: 25 }).nextMedal).toBeNull();
  });

  it("collects MMR automatically: OpenDota estimate first, then the medal's midpoint", () => {
    const est = rankView({ mmr: null, computedMmr: 3500, rankTier: 53, perGame: 25, offset: 25 });
    expect(est).toMatchObject({ source: "estimate", approximate: true, mmr: 3525, label: "Legend 3" });
    // Archon 3 = 2618..2772, midpoint 2695
    const med = rankView({ mmr: null, computedMmr: null, rankTier: 43, perGame: 25 });
    expect(med).toMatchObject({ source: "medal", approximate: true, mmr: 2695, label: "Archon 3" });
    expect(med.nextStar).toMatchObject({ label: "Archon 4", remaining: 77 });
    // A typed-in MMR always wins and isn't approximate
    expect(rankView({ mmr: 3000, computedMmr: 3500, rankTier: 53, perGame: 25 })).toMatchObject({ source: "mmr", approximate: false, mmr: 3000 });
    expect(rankView({ mmr: null, rankTier: null, perGame: 25 }).source).toBe("none");
  });

  it("parses OpenDota's computed_mmr", () => {
    const s = parsePlayerSummary(1, { profile: { personaname: "x" }, rank_tier: 53, computed_mmr: 3497.6 }, []);
    expect(s.computedMmr).toBe(3498);
    expect(parsePlayerSummary(1, { profile: {}, computed_mmr: null }, []).computedMmr).toBeNull();
  });

  it("adds games finished after the estimate was fetched", () => {
    const settings = new SettingsStore(null);
    const fetchedAt = Date.now() - 60_000;
    const summary = { accountId: 100000006, name: "me", avatar: null, rankTier: 53, leaderboardRank: null, rank: "Legend 3", computedMmr: 3500, recent: null, topHeroes: [], isPrivate: false, fetchedAt };
    const state = new CoachState(new Advisor({ runtime: rt(false), call: null }), async () => null, undefined as never, settings, async () => summary, async () => null, async () => null);
    const lost = rawGame({ matchId: "888" });
    lost.player!.steamid = "76561198060265734";
    lost.map!.win_team = "dire";
    state.ingest(lost);
    return new Promise<void>((done) => setTimeout(() => {
      state.ingest(lost);
      expect(settings.get().rank.mmr).toBeNull(); // nothing typed in, nothing written
      expect(state.rank()).toMatchObject({ source: "estimate", mmr: 3475 });
      done();
    }, 0));
  });

  it("scores a finished game", () => {
    expect(gameResultDelta("radiant", "radiant", 25)).toBe(25);
    expect(gameResultDelta("dire", "radiant", 25)).toBe(-25);
    expect(gameResultDelta(undefined, "radiant", 25)).toBeNull();
    expect(gameResultDelta("dire", null, 25)).toBeNull();
  });

  it("settings accept, clamp and clear the MMR", () => {
    const base = defaultSettings();
    expect(mergeSettings(base, { rank: { mmr: 3210.4 } }).rank.mmr).toBe(3210);
    expect(mergeSettings(base, { rank: { mmr: 99999 } }).rank.mmr).toBe(15000);
    expect(mergeSettings({ ...base, rank: { ...base.rank, mmr: 100 } }, { rank: { mmr: null } }).rank.mmr).toBeNull();
    expect(mergeSettings(base, { rank: { mmr: "abc" } }).rank.mmr).toBeNull();
    expect(mergeSettings(base, { draft: { position: 3 } }).draft.position).toBe(3);
    expect(mergeSettings(base, { draft: { position: 9 } }).draft.position).toBe(0);
  });

  it("moves the MMR once per finished match and can undo it", () => {
    const settings = new SettingsStore(null);
    settings.update({ rank: { mmr: 3000 } });
    const state = new CoachState(new Advisor({ runtime: rt(false), call: null }), async () => null, undefined as never, settings, async () => null, async () => null, async () => null);
    const won = rawGame({ matchId: "777" });
    won.map!.win_team = "radiant";
    state.ingest(won);
    state.ingest(won); // GSI keeps sending the final state
    expect(settings.get().rank.mmr).toBe(3025);
    expect(state.rank().lastChange?.delta).toBe(25);
    expect(state.undoLastRankChange()).toBe(true);
    expect(settings.get().rank.mmr).toBe(3000);
    state.ingest(won);
    expect(settings.get().rank.mmr).toBe(3000); // still counted, not re-applied
  });
});

describe("recent games", () => {
  it("parses the last matches and works out wins from slot + result", async () => {
    const { parseRecentMatches } = await import("../src/data/opendota.js");
    const list = parseRecentMatches([
      { match_id: 1, hero_id: 8, player_slot: 1, radiant_win: true, kills: 5, deaths: 2, assists: 7, gold_per_min: 600, xp_per_min: 700, last_hits: 200, duration: 2400, start_time: 100, lobby_type: 7 },
      { match_id: 2, hero_id: 54, player_slot: 130, radiant_win: true, kills: 1, deaths: 9, assists: 3, gold_per_min: 300, duration: 1800, start_time: 50, lobby_type: 0 },
      { match_id: 3 }, // incomplete: skipped
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ won: true, ranked: true, kills: 5, gpm: 600 });
    expect(list[1]).toMatchObject({ won: false, ranked: false });
  });

  it("loads them for the remembered account and adds hero names", async () => {
    const settings = new SettingsStore(null);
    const state = new CoachState(new Advisor({ runtime: rt(false), call: null }), async () => null, undefined as never, settings, async () => null, async () => null, async () => null);
    state.loadRecent = async () => [{ matchId: 1, heroId: 8, won: true, kills: 5, deaths: 2, assists: 7, gpm: 600, xpm: 700, lastHits: 200, durationSec: 2400, startTime: 100, ranked: true }];
    settings.saveData("me.json", { accountId: 42 });
    state.loadMeFor(state.rememberedAccount()!);
    expect(state.recentGames()?.status).toBe("loading");
    await new Promise((r) => setTimeout(r, 0));
    expect(state.recentGames()).toMatchObject({ status: "ok", wins: 1, losses: 0, matches: [{ heroName: "Juggernaut", hero: "npc_dota_hero_juggernaut" }] });
  });
});

describe("upcoming skill", () => {
  it("says what to take at the next level when no point is waiting", async () => {
    const { upcomingSkill } = await import("../src/engine/skills.js");
    // Level 5 with 5 points spent: nothing waiting; level 6 brings the ultimate
    const s = normalize(rawGame({ level: 5, abilityLevels: [3, 1, 1, 0] }));
    expect(upcomingSkill(s, null)).toMatchObject({ key: "juggernaut_omni_slash", atLevel: 6 });
    // A point waiting now: that's `next`, not upcoming
    expect(upcomingSkill(normalize(rawGame({ level: 6, abilityLevels: [3, 1, 1, 0] })), null)).toBeNull();
    // Level 16 -> 17 grants no point, so the next pick is at 18
    const lvl16 = normalize(rawGame({ level: 16, abilityLevels: [4, 4, 4, 2], talents: [true, false, true, false, false, false, false, false] }));
    expect(upcomingSkill(lvl16, null)?.atLevel).toBe(18);
  });
});

describe("stale game data", () => {
  it("drops the last game once Dota has been quiet past the heartbeat", () => {
    const state = new CoachState(new Advisor({ runtime: rt(false), call: null }), async () => null, undefined as never, new SettingsStore(null), async () => null, async () => null, async () => null);
    state.draftDeps = { loadHeroStats: async () => null, loadMatchups: async () => null, loadLanes: async () => null }; // no network in tests
    state.ingest(rawGame());
    expect(state.expireIfStale(state.lastGsiAt + 30_000)).toBe(false);
    expect(state.snapshot?.hero).toBeTruthy();
    expect(state.expireIfStale(state.lastGsiAt + 80_000)).toBe(true);
    expect(state.snapshot).toBeNull();
    expect(state.report).toBeNull();
    expect(state.draft()).not.toBeNull(); // back to the pre-game view
    expect(state.expireIfStale(state.lastGsiAt + 90_000)).toBe(false);
  });
});

describe("draft", () => {
  const jugg = getHero("npc_dota_hero_juggernaut")!;
  const cm = getHero("npc_dota_hero_crystal_maiden")!;
  const axe = getHero("npc_dota_hero_axe")!;

  it("matches heroes to positions by role", () => {
    expect(positionFit(jugg.roles, 1)).toBeGreaterThanOrEqual(0.5);
    expect(positionFit(cm.roles, 1)).toBe(0);
    expect(positionFit(cm.roles, 5)).toBeGreaterThanOrEqual(0.5);
    expect(positionFit(axe.roles, 3)).toBeGreaterThanOrEqual(0.5);
    expect(positionFit(cm.roles, 0)).toBe(1);
  });

  it("corrects the role fit by the lane the hero is actually played in", () => {
    const lanes = parseLaneRoles([
      { lane_role: 1, games: "50" }, { lane_role: 2, games: "900" }, { lane_role: 3, games: "50" },
    ])!;
    expect(lanes.share[2]).toBeCloseTo(0.9);
    expect(laneAdjustedFit(0.7, lanes, 2)).toBe(0.82); // 0.7*0.6 + 1*0.4
    expect(laneAdjustedFit(0.7, lanes, 1)).toBe(0); // 5% safe lane: below the 8% cut-off
    expect(laneAdjustedFit(0.7, { games: 1000, share: { 1: 0.02, 2: 0.98, 3: 0, 4: 0 } }, 5)).toBe(0);
    expect(laneAdjustedFit(0.7, undefined, 2)).toBe(0.7);
    expect(laneAdjustedFit(0.7, { games: 50, share: { 1: 0, 2: 1, 3: 0, 4: 0 } }, 1)).toBe(0.7); // too few games
  });

  it("measures head-to-head advantage against what the win rates predict", () => {
    // Enemy won 40 of 100 vs the candidate: candidate 60% where 50% was expected, shrunk by 100/250
    const m = parseMatchups([{ hero_id: 8, games_played: 100, wins: 40 }]);
    const a = matchupAdvantage(m, 8, 0.5, 0.5)!;
    expect(a.advantage).toBeCloseTo(0.1 * (100 / 250));
    expect(matchupAdvantage(parseMatchups([{ hero_id: 8, games_played: 5, wins: 0 }]), 8, 0.5, 0.5)).toBeNull();
  });

  it("ranks counters for the position and skips taken heroes", () => {
    const stats = parseHeroStats([
      { id: jugg.id, "4_pick": 1000, "4_win": 500 },
      { id: getHero("npc_dota_hero_antimage")!.id, "4_pick": 1000, "4_win": 500 },
      { id: cm.id, "4_pick": 1000, "4_win": 500 },
    ]);
    const enemy = axe;
    const matchups = new Map([[enemy.id, parseMatchups([
      { hero_id: getHero("npc_dota_hero_antimage")!.id, games_played: 300, wins: 120 },
      { hero_id: jugg.id, games_played: 300, wins: 180 },
    ])]]);
    const out = suggestPicks({
      heroes: [jugg, getHero("npc_dota_hero_antimage")!, cm],
      enemies: [enemy], taken: new Set(), position: 1, bracket: 4, stats, matchups,
    });
    expect(out.map((s) => s.name)).toEqual(["Anti-Mage", "Juggernaut"]); // CM doesn't fit pos 1
    expect(out[0].reasons[0]).toMatchObject({ enemy: "Axe" });
    expect(out[0].reasons[0].advantage).toBeGreaterThan(0);
    const taken = suggestPicks({ heroes: [jugg], enemies: [], taken: new Set([jugg.id]), position: 1, bracket: null, stats, matchups });
    expect(taken).toEqual([]);
  });
});

describe("bug fixes: skill points, late start, ranked-only MMR", () => {
  const mk = (settings = new SettingsStore(null)) => {
    const state = new CoachState(new Advisor({ runtime: rt(false), call: null }), async () => null, undefined as never, settings, async () => null, async () => null, async () => null);
    state.draftDeps = { loadHeroStats: async () => null, loadMatchups: async () => null, loadLanes: async () => null };
    return { state, settings };
  };

  it("counts Morphling's linked Attribute Shift once and ignores hidden sub-abilities", async () => {
    const { unspentPoints } = await import("../src/engine/skills.js");
    const raw = rawGame({ hero: "npc_dota_hero_morphling", heroId: 10, level: 3 });
    // Level 3: Waveform 1, Adaptive Strike 1, Attribute Shift 1 (GSI reports both halves at level 1)
    raw.abilities = {
      ability0: { name: "morphling_waveform", level: 1 },
      ability1: { name: "morphling_adaptive_strike_agi", level: 1 },
      ability2: { name: "morphling_morph_agi", level: 1 },
      ability3: { name: "morphling_morph_str", level: 1 },
      ability4: { name: "morphling_replicate", level: 0, ultimate: true },
      ability5: { name: "morphling_morph_replicate", level: 1 },
    };
    expect(unspentPoints(normalize(raw))).toBe(0);
    raw.hero!.level = 4;
    expect(unspentPoints(normalize(raw))).toBe(1); // used to read 0: the twin ate the point
  });

  it("still looks for enemies when started after 15:00 with none known, but not forever", () => {
    const { state, settings } = mk();
    settings.update({ detection: { enabled: true } });
    state.ingest(rawGame({ clock: 20 * 60 }));
    expect(state.visionWanted()).toBe(true);
    (state as unknown as { visionGrabs: number }).visionGrabs = 8;
    expect(state.visionWanted()).toBe(false);
  });

  it("takes an unranked game back out of the MMR once OpenDota lists it, and keeps ranked ones", async () => {
    const { state, settings } = mk();
    settings.update({ rank: { mmr: 3000 } });
    const game = (matchId: string) => {
      const g = rawGame({ matchId });
      g.player!.steamid = "76561198060265734"; // account 100000006
      g.map!.win_team = "radiant";
      return g;
    };
    const base = { heroId: 8, won: true, kills: 1, deaths: 1, assists: 1, gpm: 1, xpm: 1, lastHits: 1, durationSec: 1, startTime: 1 };
    state.loadRecent = async () => [{ ...base, matchId: 501, ranked: false }, { ...base, matchId: 502, ranked: true }];
    state.ingest(game("501"));
    state.ingest(game("502"));
    expect(settings.get().rank.mmr).toBe(3050);
    await new Promise((r) => setTimeout(r, 0)); // recent matches arrive
    expect(settings.get().rank.mmr).toBe(3025); // 501 was unranked, 502 stays
    (state as unknown as { loadRecentFor(id: number, fresh: boolean): void }).loadRecentFor(100000006, true);
    await new Promise((r) => setTimeout(r, 0));
    expect(settings.get().rank.mmr).toBe(3025); // checked once, never taken back twice
  });
});

describe("Korean output and the post-game review", () => {
  it("writes alerts and timers in the chosen language", async () => {
    const { buildAlerts } = await import("../src/engine/alerts.js");
    const { buildTimers } = await import("../src/engine/timers.js");
    const s = normalize(rawGame({ hp: 10, tp: false }));
    const ko = buildAlerts(s, 1, [], { lowHpPct: 25, goldAlert: 2000, lang: "ko" });
    expect(ko.find((a) => a.id === "low-hp")!.text).toContain("체력 10%");
    expect(ko.find((a) => a.id === "no-tp")!.text).toBe("TP 스크롤 없음");
    expect(buildAlerts(s, 1, [], { lowHpPct: 25, goldAlert: 2000 }).find((a) => a.id === "no-tp")!.text).toBe("No TP scroll");
    expect(buildTimers(s, {}, "ko").find((t) => t.id === "bounty")!.label).toBe("바운티 룬");
    expect(buildTimers(s).find((t) => t.id === "bounty")!.label).toBe("Bounty rune");
  });

  it("asks the model to answer in Korean by default and in English when set", async () => {
    const { systemPrompt } = await import("../src/ai/prompt.js");
    expect(systemPrompt("ko")).toContain("Korean");
    expect(systemPrompt("en")).toContain("Write in English.");
    expect(systemPrompt("ko")).not.toContain("__LANGUAGE__");
    expect(defaultSettings().language).toBe("ko");
    expect(mergeSettings(defaultSettings(), { language: "en" }).language).toBe("en");
    expect(mergeSettings(defaultSettings(), { language: "xx" }).language).toBe("ko");
  });

  it("reviews a finished match once, with the result and the numbers", async () => {
    const settings = new SettingsStore(null);
    settings.setApiKey("sk-test-key-that-is-long-enough");
    const state = new CoachState(new Advisor({ runtime: rt(false), call: null }), async () => null, undefined as never, settings, async () => null, async () => null, async () => null);
    const seen: { payload: any; language: string }[] = [];
    state.reviewCaller = async (payload, o) => {
      seen.push({ payload, language: o.language });
      return { summary: "요약", good: ["막타 좋음"], improve: ["데스 줄이기"] };
    };
    state.ingest(rawGame({ matchId: "900", clock: 1800 }));
    expect(seen).toHaveLength(0); // still playing
    const end = rawGame({ matchId: "900", clock: 2400 });
    end.map!.win_team = "dire";
    state.ingest(end);
    state.ingest(end);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    expect(seen[0].language).toBe("ko");
    expect(seen[0].payload).toMatchObject({ hero: "Juggernaut", result: "loss", duration: "40 min", kda: "2/0/3" });
    expect(state.review).toMatchObject({ matchId: "900", won: false, summary: "요약", improve: ["데스 줄이기"] });
    expect(state.toJSON().reviewStatus).toBe("idle");
  });
});

describe("Invoker", () => {
  it("levels Quas/Wex/Exort past 4, up to 7", async () => {
    const { recommendSkill, maxBasicLevel } = await import("../src/engine/skills.js");
    expect(maxBasicLevel("invoker_exort")).toBe(7);
    expect(maxBasicLevel("juggernaut_blade_fury")).toBe(4);
    const raw = rawGame({ hero: "npc_dota_hero_invoker", heroId: 74, level: 12 });
    // Level 12: Exort 4, Quas 3, Wex 3 + one talent = 11 points, one free; level 12 allows up to level 6
    raw.abilities = {
      ability0: { name: "invoker_quas", level: 3 },
      ability1: { name: "invoker_wex", level: 3 },
      ability2: { name: "invoker_exort", level: 4 },
      ability5: { name: "invoker_invoke", level: 1 },
    };
    raw.hero!.talent_2 = true; // level 10 talent taken
    const next = recommendSkill(normalize(raw), ["invoker_exort", "invoker_quas", "invoker_wex"]).next;
    expect(next?.key).toBe("invoker_exort"); // used to be blocked at 4
  });
});
