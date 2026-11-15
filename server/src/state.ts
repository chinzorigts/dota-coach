import type { RawGsi } from "./gsi/types.js";
import { normalize, type GameSnapshot } from "./gsi/normalize.js";
import { allHeroes, getAbility, getHero, getItem, type HeroInfo } from "./data/constants.js";
import {
  getHeroBenchmarks,
  getHeroStats,
  getItemPopularity,
  getMatchups,
  getPlayerHeroTotals,
  getPlayerSummary,
  getRecentMatches,
  type RecentMatch,
  type HeroBenchmarks,
  type HeroStat,
  type ItemPopularity,
  type Matchups,
  type PlayerHeroTotals,
  type PlayerSummary,
} from "./data/opendota.js";
import { compareStats } from "./engine/benchmarks.js";
import { bandForMmr, gameResultDelta, rankView, type RankView } from "./engine/rank.js";
import { suggestPicks, type DraftView } from "./engine/draft.js";
import { classifyPurchase, newItems, type Purchase } from "./engine/purchases.js";
import { ownedItems } from "./engine/items.js";

/**
 * Dota sends GSI at least every 30s while it runs (the cfg's heartbeat). Nothing for this long means the game was
 * closed, or the data came from a test run (npm run mock), so the last game must not keep showing as live.
 */
export const GSI_STALE_MS = 75_000;

/** Grabs to give the matcher before asking the AI, and how often the AI may be asked per match */
const AI_VISION_AFTER_GRABS = 4;
const AI_VISION_MAX_TRIES = 2;

/** Grabs allowed after the cut-off when no enemy is known yet (app started mid-game) */
const LATE_START_GRABS = 8;

/** Stop top-bar capture after this much game time (see visionWanted) */
const VISION_GIVE_UP_SEC = 15 * 60;

/** A courier trip from fountain to lane rarely takes longer than this */
const TRANSIT_MS = 90_000;

/** OpenDota usually has a finished match parsed within ~20 minutes */
const ME_REFRESH_AFTER_GAME_MS = 20 * 60 * 1000;

/** Applied MMR changes, kept so a match is never counted twice (even across restarts) and the last one can be undone */
interface RankHistory {
  /** checked = OpenDota has since told us whether the match was ranked */
  applied: { matchId: string; delta: number; at: number; checked?: boolean }[];
}
import type { LobbyInfo, TeamSide } from "./matchlog/parser.js";
import type { WatcherStatus } from "./matchlog/watcher.js";
import { buildReport, type CoachReport, type RolePref } from "./engine/index.js";
import type { Advisor } from "./ai/advisor.js";
import { EnemyDetector, type DetectionResult, type Side, type SlotResult } from "./vision/detector.js";
import type { RGBImage } from "./vision/image.js";
import type { TemplateBank } from "./vision/matcher.js";
import { getTemplateBank, saveLearnedPortrait } from "./vision/templates.js";
import { identifyPortraits, type PortraitIdentifier } from "./vision/identify.js";
import { fromRGBA } from "./vision/image.js";
import { PNG } from "pngjs";
import { SettingsStore } from "./settings.js";

/** Where the current enemy list came from. Manual always wins; auto sources never overwrite it. */
export type EnemySource = "none" | "manual" | "gsi" | "vision";

export interface DetectionStatus {
  calibration: DetectionResult["calibration"] | null;
  slots: SlotResult[];
  lastAt: number;
  error: string | null;
}

const emptyDetection = (): DetectionStatus => ({ calibration: null, slots: [], lastAt: 0, error: null });

/** A lobby line older than this was left over from an earlier session; don't show it as the current match. */
const LOBBY_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export interface MatchPlayerView {
  slot: number;
  accountId: number;
  isMe: boolean;
  /** Index into the lobby's party list, so the UI can mark players who queued together */
  party: number | null;
  status: "loading" | "ok" | "failed";
  stats: (Omit<PlayerSummary, "topHeroes"> & { topHeroes: { heroId: number; name: string | null; games: number; wins: number }[] }) | null;
}

/**
 * Who is in the match, from server_log.txt. Region and ping are deliberately absent: neither the log nor GSI
 * carries a region, and the matchmaking server is reached through Valve's SDR relays (the log only names a
 * game-server Steam ID), so there is no address to measure a ping against.
 */
export interface MatchInfoView {
  lobbyId: string;
  gameMode: string;
  detectedAt: number | null;
  myTeam: TeamSide | null;
  allies: MatchPlayerView[];
  enemies: MatchPlayerView[];
}

export class CoachState {
  snapshot: GameSnapshot | null = null;
  report: CoachReport | null = null;
  enemies: string[] = [];
  enemySource: EnemySource = "none";
  detection: DetectionStatus = emptyDetection();
  private detector: EnemyDetector | null = null;
  /** AI fallback for portraits the matcher can't place. Replaceable in tests. */
  identify: PortraitIdentifier = identifyPortraits;
  persistLearned: (hero: string, png: Buffer) => Promise<void> = saveLearnedPortrait;
  private visionGrabs = 0;
  private aiVisionTries = 0;
  private identifying = false;
  rolePref: RolePref = "auto";
  popularity: ItemPopularity | null = null;
  popularityHero: number | null = null;
  lastGsiAt = 0;
  private matchId: string | null = null;
  private listeners = new Set<() => void>();
  /** Latest lobby from server_log.txt, independent of the GSI match id (the lobby line is written before GSI has one) */
  lobby: LobbyInfo | null = null;
  private playerStats = new Map<number, PlayerSummary | "loading" | null>();
  /** Set by index.ts once the server_log watcher runs */
  matchLogStatus: () => WatcherStatus | null = () => null;
  /** Hero averages and our own averages on the hero being played, for "you vs average" */
  private bench: { heroId: number; data: HeroBenchmarks | null | "loading" } | null = null;
  private totals: { key: string; data: PlayerHeroTotals | null | "loading" } | null = null;
  /** What you bought this match, and the recommendations those purchases made redundant */
  purchases: Purchase[] = [];
  private skipped = new Set<string>();
  /** Most copies of each item seen this match. Items riding the courier vanish from GSI for a while, so a
   * purchase is a count going above this, not merely an item reappearing. */
  private maxSeen = new Map<string, number>();
  /** When each item was last in the bag/stash; for items riding the courier (GSI can't see the courier) */
  private lastSeenAt = new Map<string, number>();
  private inTransit: string[] = [];
  /** Your last 5 matches (OpenDota). Replaceable in tests. */
  loadRecent: (accountId: number, fresh?: boolean) => Promise<RecentMatch[] | null> = getRecentMatches;
  private recent: { accountId: number; data: RecentMatch[] | null | "loading" } | null = null;
  /** Draft data, loaded on first use. Replaceable in tests. */
  draftDeps = { loadHeroStats: getHeroStats, loadMatchups: getMatchups };
  private heroStats: Map<number, HeroStat> | null | "loading" | undefined;
  private matchups = new Map<number, Matchups | null | "loading">();
  /** Our own OpenDota profile (medal) once GSI has told us who we are */
  private me: { accountId: number; summary: PlayerSummary | null | "loading" } | null = null;

  constructor(
    private advisor: Advisor,
    private loadPopularity: (heroId: number) => Promise<ItemPopularity | null> = getItemPopularity,
    private loadBank: () => Promise<{ bank: TemplateBank }> = getTemplateBank,
    readonly settings: SettingsStore = new SettingsStore(null),
    private loadPlayer: (accountId: number, fresh?: boolean) => Promise<PlayerSummary | null> = getPlayerSummary,
    private loadBench: (heroId: number) => Promise<HeroBenchmarks | null> = getHeroBenchmarks,
    private loadTotals: (accountId: number, heroId: number) => Promise<PlayerHeroTotals | null> = getPlayerHeroTotals,
  ) {
    this.rolePref = settings.get().coach.defaultRole;
    let lastDefaultRole = this.rolePref;
    settings.onChange(() => {
      // A new default role applies right away; the footer buttons still override it for this session
      const role = settings.get().coach.defaultRole;
      if (role !== lastDefaultRole) this.rolePref = lastDefaultRole = role;
      this.recompute();
      this.emit();
    });
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
      this.enemySource = "none";
      this.detector?.reset();
      this.visionGrabs = 0;
      this.aiVisionTries = 0;
      this.detection = emptyDetection();
      this.advisor.reset();
      this.purchases = [];
      this.skipped.clear();
      this.maxSeen.clear();
      this.lastSeenAt.clear();
      this.inTransit = [];
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

    this.loadReferences(snap);
    this.loadMe(snap);
    this.applyGameResult(snap);
    const bought = this.detectPurchases(snap);
    this.snapshot = snap;
    this.applyGsiLineup(snap);
    this.recompute();
    if (this.snapshot && this.report) {
      const offPlan = bought.filter((p) => !p.followed);
      // A different buy than suggested changes the plan: ask again now instead of at the next death or 5:00 mark
      if (offPlan.length) void this.advisor.onPurchase(this.snapshot, this.report, this.enemies, offPlan);
      void this.advisor.onSnapshot(this.snapshot, this.report, this.enemies);
    }
    this.emit();
  }

  /**
   * A new lobby from server_log.txt. Only account IDs are known at this point (picks come later), so this never
   * touches `enemies` (heroes from GSI / vision / manual pick); the two are shown side by side.
   */
  ingestLobby(lobby: LobbyInfo, now = Date.now()) {
    if (lobby.at !== null && now - lobby.at > LOBBY_MAX_AGE_MS) return;
    if (lobby.lobbyId === this.lobby?.lobbyId) return;
    this.lobby = lobby;
    this.playerStats.clear();
    this.emit();
    // Enemies first: they are what the panel is for, and OpenDota requests are queued one by one
    const mine = this.myTeam();
    const ordered = [...lobby.players].sort((a, b) => Number(a.team === mine) - Number(b.team === mine));
    for (const p of ordered) {
      this.playerStats.set(p.accountId, "loading");
      this.loadPlayer(p.accountId)
        .catch(() => null)
        .then((s) => {
          if (this.lobby !== lobby) return;
          this.playerStats.set(p.accountId, s);
          this.emit();
        });
    }
  }

  /** Our side: by our account ID in the lobby when GSI has sent it, else the team GSI reports */
  private myTeam(): TeamSide | null {
    const me = this.snapshot?.player?.accountId;
    const fromLobby = me ? this.lobby?.players.find((p) => p.accountId === me)?.team : null;
    return fromLobby ?? this.snapshot?.team ?? null;
  }

  matchInfo(): MatchInfoView | null {
    const lobby = this.lobby;
    if (!lobby || !this.settings.get().matchInfo.enabled) return null;
    const myTeam = this.myTeam();
    const me = this.snapshot?.player?.accountId ?? null;
    const view = (p: LobbyInfo["players"][number]): MatchPlayerView => {
      const s = this.playerStats.get(p.accountId);
      const party = lobby.parties.findIndex((members) => members.includes(p.accountId));
      return {
        slot: p.slot,
        accountId: p.accountId,
        isMe: p.accountId === me,
        party: party >= 0 ? party : null,
        status: s === "loading" || s === undefined ? "loading" : s ? "ok" : "failed",
        stats:
          s && s !== "loading"
            ? { ...s, topHeroes: s.topHeroes.map((h) => ({ ...h, name: getHero(h.heroId)?.name ?? null })) }
            : null,
      };
    };
    const sided = lobby.players.filter((p) => p.team);
    return {
      lobbyId: lobby.lobbyId,
      gameMode: lobby.gameMode,
      detectedAt: lobby.at,
      myTeam,
      // Side unknown (no GSI yet): fall back to Radiant/Dire; the UI labels them by myTeam === null
      allies: myTeam ? sided.filter((p) => p.team === myTeam).map(view) : sided.filter((p) => p.team === "radiant").map(view),
      enemies: myTeam ? sided.filter((p) => p.team !== myTeam).map(view) : sided.filter((p) => p.team === "dire").map(view),
    };
  }

  /**
   * An item that was in your bag/stash a moment ago and isn't now is most likely on the courier (GSI doesn't list
   * it). Count it as owned for up to TRANSIT_MS so it isn't suggested again mid-delivery, unless it went into
   * something you just built (then it's a used-up part, not a missing item).
   */
  private trackTransit(owned: string[], now: number) {
    for (const k of owned) this.lastSeenAt.set(k, now);
    const builtParts = new Set(owned.flatMap((k) => getItem(k)?.components ?? []));
    this.inTransit = [...this.lastSeenAt]
      .filter(([k, at]) => !owned.includes(k) && now - at < TRANSIT_MS && !builtParts.has(k))
      .map(([k]) => k);
  }

  /** Forget the last game once GSI has gone quiet (called on a timer by index.ts). Returns true when it cleared. */
  expireIfStale(now = Date.now()): boolean {
    if (!this.snapshot || now - this.lastGsiAt < GSI_STALE_MS) return false;
    this.snapshot = null;
    this.report = null;
    this.emit();
    return true;
  }

  /** Compare the inventory with what we've seen this match; classify anything new against the last recommendations */
  private detectPurchases(snap: GameSnapshot): Purchase[] {
    if (!snap.hero) return [];
    const owned = ownedItems(snap);
    const counts = new Map<string, number>();
    for (const k of owned) counts.set(k, (counts.get(k) ?? 0) + 1);
    this.trackTransit(owned, snap.receivedAt);
    // The first snapshot of a match (or a mid-game restart) is the starting inventory, not a purchase
    const first = this.maxSeen.size === 0;
    const seenList = [...this.maxSeen].flatMap(([k, n]) => Array<string>(n).fill(k));
    for (const [k, n] of counts) this.maxSeen.set(k, Math.max(n, this.maxSeen.get(k) ?? 0));
    if (first) {
      if (this.maxSeen.size === 0) this.maxSeen.set("__start__", 0); // remember we've started even with an empty bag
      return [];
    }
    const recs = this.report?.items ?? [];
    const out: Purchase[] = [];
    for (const key of newItems(seenList, owned)) {
      const p = classifyPurchase(key, recs, snap.clockTime);
      if (!p) continue;
      out.push(p);
      for (const r of p.replaced) this.skipped.add(r);
    }
    if (out.length) this.purchases = [...this.purchases, ...out].slice(-20);
    return out;
  }

  /** Fetch the reference numbers once per hero (and once per account+hero); both are cached on disk too */
  private loadReferences(snap: GameSnapshot) {
    const heroId = snap.hero?.id;
    if (!heroId) return;
    if (this.bench?.heroId !== heroId) {
      const entry: { heroId: number; data: HeroBenchmarks | null | "loading" } = { heroId, data: "loading" };
      this.bench = entry;
      this.loadBench(heroId)
        .catch(() => null)
        .then((d) => {
          if (this.bench !== entry) return;
          entry.data = d;
          this.emit();
        });
    }
    const accountId = snap.player?.accountId;
    const key = accountId ? `${accountId}-${heroId}` : null;
    if (key && accountId && this.totals?.key !== key) {
      const entry: { key: string; data: PlayerHeroTotals | null | "loading" } = { key, data: "loading" };
      this.totals = entry;
      this.loadTotals(accountId, heroId)
        .catch(() => null)
        .then((d) => {
          if (this.totals !== entry) return;
          entry.data = d;
          this.emit();
        });
    }
  }

  private loadMe(snap: GameSnapshot) {
    const accountId = snap.player?.accountId;
    if (!accountId || this.me?.accountId === accountId) return;
    // Remember who we are, so rank and recent games show right after a restart, before Dota sends anything
    this.settings.saveData("me.json", { accountId });
    this.loadMeFor(accountId);
  }

  /** Called with the remembered account at startup (index.ts) and whenever GSI reports a new one */
  loadMeFor(accountId: number) {
    if (this.me?.accountId === accountId) return;
    const entry: { accountId: number; summary: PlayerSummary | null | "loading" } = { accountId, summary: "loading" };
    this.me = entry;
    this.loadPlayer(accountId)
      .catch(() => null)
      .then((s) => {
        if (this.me !== entry) return;
        entry.summary = s;
        this.emit();
      });
    this.loadRecentFor(accountId);
  }

  rememberedAccount(): number | null {
    const raw = this.settings.loadData("me.json") as { accountId?: unknown } | null;
    return typeof raw?.accountId === "number" && raw.accountId > 0 ? raw.accountId : null;
  }

  private loadRecentFor(accountId: number, fresh = false) {
    const entry: { accountId: number; data: RecentMatch[] | null | "loading" } =
      fresh && this.recent?.accountId === accountId ? this.recent : { accountId, data: "loading" };
    this.recent = entry;
    this.loadRecent(accountId, fresh)
      .catch(() => null)
      .then((d) => {
        if (this.recent !== entry) return;
        // A failed refresh keeps the list we already had
        if (d !== null || entry.data === "loading") entry.data = d;
        if (d) this.reconcileRank(d);
        this.emit();
      });
  }

  /**
   * GSI can't tell ranked from unranked, so a finished game changes the MMR right away and is checked here once
   * OpenDota lists the match: an unranked game (normal, turbo...) is taken back out automatically.
   */
  private reconcileRank(recent: RecentMatch[]) {
    const history = this.rankHistory();
    let changed = false;
    let revert = 0;
    history.applied = history.applied.map((a) => {
      if (a.checked) return a;
      const m = recent.find((r) => String(r.matchId) === a.matchId);
      if (!m) return a;
      changed = true;
      if (m.ranked || a.delta === 0) return { ...a, checked: true };
      revert += a.delta;
      return { ...a, delta: 0, checked: true };
    });
    if (!changed) return;
    this.settings.saveData("rank.json", history);
    const mmr = this.settings.get().rank.mmr;
    if (revert !== 0 && mmr !== null) this.settings.update({ rank: { mmr: Math.max(0, mmr - revert) } });
    if (revert !== 0) console.log("[rank] unranked match: took back " + (revert > 0 ? "+" : "") + revert + " MMR");
  }

  /** Your last 5 matches with hero names, for the dashboard and the pre-game overlay */
  recentGames() {
    const r = this.recent;
    if (!r) return null;
    if (r.data === "loading" || r.data === null) return { status: r.data === "loading" ? "loading" : "unavailable", matches: [] };
    const matches = r.data.map((m) => {
      const h = getHero(m.heroId);
      return { ...m, hero: h?.name ?? null, heroName: h?.localizedName ?? `Hero ${m.heroId}` };
    });
    const wins = matches.filter((m) => m.won).length;
    return { status: "ok", matches, wins, losses: matches.length - wins };
  }

  private rankHistory(): RankHistory {
    const raw = this.settings.loadData("rank.json") as RankHistory | null;
    return raw && Array.isArray(raw.applied) ? raw : { applied: [] };
  }

  /**
   * After a finished game, record ±perGame once per match. A typed-in MMR is moved directly; the automatic
   * estimate adds the changes made since it was fetched, and is fetched again once OpenDota has had time to
   * process the match.
   */
  private applyGameResult(snap: GameSnapshot) {
    const r = this.settings.get().rank;
    if (!r.autoAdjust || !snap.matchId || !snap.hero) return;
    const delta = gameResultDelta(snap.winTeam ?? undefined, snap.team, r.perGame);
    if (delta === null) return;
    const history = this.rankHistory();
    if (history.applied.some((a) => a.matchId === snap.matchId)) return;
    history.applied = [...history.applied, { matchId: snap.matchId, delta, at: Date.now() }].slice(-50);
    this.settings.saveData("rank.json", history);
    if (r.mmr !== null) this.settings.update({ rank: { mmr: Math.max(0, r.mmr + delta) } });
    else this.emit();
    const accountId = snap.player?.accountId;
    if (accountId) {
      clearTimeout(this.meRefresh);
      this.meRefresh = setTimeout(() => this.refreshMe(accountId), ME_REFRESH_AFTER_GAME_MS);
      this.meRefresh.unref?.();
      // The match usually shows up in recentMatches within a few minutes; check early too
      setTimeout(() => this.loadRecentFor(accountId, true), 3 * 60 * 1000).unref?.();
    }
  }

  private meRefresh: ReturnType<typeof setTimeout> | undefined;

  /** Fetch our profile again past the caches (medal and estimate change after games) */
  private refreshMe(accountId: number) {
    this.loadRecentFor(accountId, true);
    this.loadPlayer(accountId, true)
      .catch(() => null)
      .then((s) => {
        if (!s || this.me?.accountId !== accountId) return;
        this.me = { accountId, summary: s };
        this.emit();
      });
  }

  /** Revert the last automatic change (e.g. it was an unranked game). The match stays marked as counted. */
  undoLastRankChange(): boolean {
    const history = this.rankHistory();
    const last = history.applied[history.applied.length - 1];
    if (!last || last.delta === 0) return false;
    history.applied[history.applied.length - 1] = { ...last, delta: 0 };
    this.settings.saveData("rank.json", history);
    const mmr = this.settings.get().rank.mmr;
    if (mmr !== null) this.settings.update({ rank: { mmr: Math.max(0, mmr - last.delta) } });
    else this.emit();
    return true;
  }

  rank(): RankView {
    const r = this.settings.get().rank;
    const summary = this.me && this.me.summary !== "loading" ? this.me.summary : null;
    const applied = this.rankHistory().applied;
    const last = applied.at(-1);
    // Games finished after OpenDota's numbers were fetched aren't in them yet
    const since = summary?.fetchedAt ?? Infinity;
    const offset = applied.filter((a) => a.at > since).reduce((sum, a) => sum + a.delta, 0);
    return rankView({
      mmr: r.mmr,
      computedMmr: summary?.computedMmr ?? null,
      rankTier: summary?.rankTier ?? null,
      perGame: r.perGame,
      offset,
      lastChange: last && last.delta !== 0 ? last : null,
    });
  }

  /** Medal bracket 1..8 for bracket win rates: from the typed MMR, else OpenDota's medal */
  private bracket(): number | null {
    const mmr = this.settings.get().rank.mmr;
    if (mmr !== null) return Math.floor(bandForMmr(mmr).tier / 10);
    const s = this.me && this.me.summary !== "loading" ? this.me.summary : null;
    return s?.rankTier ? Math.min(8, Math.floor(s.rankTier / 10)) : null;
  }

  /** Pick suggestions for your position against the enemy picks known so far (game data or typed in) */
  draft(): DraftView | null {
    const s = this.snapshot;
    // Only useful before your hero is locked in
    if (s?.hero) return null;
    const position = this.settings.get().draft.position;

    if (this.heroStats === undefined) {
      this.heroStats = "loading";
      this.draftDeps.loadHeroStats()
        .catch(() => null)
        .then((m) => {
          this.heroStats = m;
          this.emit();
        });
    }
    const enemies = this.enemies.map((n) => getHero(n)).filter((h): h is HeroInfo => Boolean(h));
    for (const e of enemies) {
      if (this.matchups.has(e.id)) continue;
      this.matchups.set(e.id, "loading");
      this.draftDeps.loadMatchups(e.id)
        .catch(() => null)
        .then((m) => {
          this.matchups.set(e.id, m);
          // A failed load is retried next time the draft is shown
          if (m === null) setTimeout(() => this.matchups.get(e.id) === null && this.matchups.delete(e.id), 30_000).unref?.();
          this.emit();
        });
    }

    const base = { position, enemies: enemies.map((e) => e.name), bracket: this.bracket() };
    if (this.heroStats === "loading") return { ...base, status: "loading", suggestions: [] };
    if (!this.heroStats) return { ...base, status: "no-data", suggestions: [] };

    const mine = s?.team ? s.lineup[s.team] : [];
    const taken = new Set<number>([...enemies.map((e) => e.id), ...mine]);
    const loaded = new Map<number, Matchups>();
    for (const e of enemies) {
      const m = this.matchups.get(e.id);
      if (m && m !== "loading") loaded.set(e.id, m);
    }
    const stillLoading = enemies.some((e) => this.matchups.get(e.id) === "loading");
    return {
      ...base,
      status: stillLoading ? "loading" : "ok",
      suggestions: suggestPicks({ heroes: allHeroes(), enemies, taken, position, bracket: base.bracket, stats: this.heroStats, matchups: loaded }),
    };
  }

  benchmark() {
    const s = this.snapshot;
    if (!s?.hero) return null;
    const bench = this.bench?.heroId === s.hero.id ? this.bench.data : "loading";
    const key = s.player?.accountId ? `${s.player.accountId}-${s.hero.id}` : null;
    const totals = key && this.totals?.key === key ? this.totals.data : key ? "loading" : null;
    return compareStats(s, bench, totals);
  }

  /** From the UI. Clearing the list hands control back to auto-detection. */
  setEnemies(heroes: string[]) {
    const valid = [...new Set(heroes)].filter((h) => getHero(h)).slice(0, 5);
    if (valid.length === 0) {
      this.detector?.reset();
      this.visionGrabs = 0;
      this.aiVisionTries = 0;
      this.detection = emptyDetection();
    }
    this.updateEnemies(valid, valid.length ? "manual" : "none");
    this.emit();
  }

  private updateEnemies(heroes: string[], source: EnemySource) {
    const changed = heroes.join() !== this.enemies.join();
    this.enemies = heroes;
    this.enemySource = source;
    this.recompute();
    // Auto-detection fills slots one by one; ask the AI once the lineup is complete, not five times
    const worthAsking = source === "manual" || source === "gsi" || heroes.length === 5;
    if (changed && worthAsking) void this.advisor.onEnemiesChanged(this.snapshot, this.report, this.enemies);
  }

  private enemySide(): Side | null {
    const t = this.snapshot?.team;
    return t === "radiant" ? "dire" : t === "dire" ? "radiant" : null;
  }

  /** Spectator / draft data straight from GSI, when the game provides it */
  private applyGsiLineup(snap: GameSnapshot) {
    const side = this.enemySide();
    if (!side || this.enemySource === "manual") return;
    const names = snap.lineup[side].map((id) => getHero(id)?.name).filter((n): n is string => Boolean(n));
    if (names.length && names.join() !== this.enemies.join()) this.updateEnemies(names, "gsi");
  }

  /** Whether the overlay should keep capturing the top bar */
  visionWanted(): boolean {
    const s = this.snapshot;
    return Boolean(
      this.settings.get().detection.enabled && s?.hero && s.team && s.inProgress &&
        this.enemySource !== "manual" && this.enemySource !== "gsi" && this.enemies.length < 5 &&
        // All ten portraits are there from the horn; what isn't recognised by 15:00 won't be by grabbing more.
        // Exception: nothing found yet and we've barely looked (the app was started or restarted mid-game).
        (s.clockTime < VISION_GIVE_UP_SEC || (this.enemies.length === 0 && this.visionGrabs < LATE_START_GRABS)),
    );
  }

  /** Top-bar portraits captured by the overlay, 5 per side */
  async ingestVision(frames: Record<Side, RGBImage[]>): Promise<DetectionStatus> {
    const s = this.snapshot;
    if (!this.visionWanted() || !s?.hero || !s.team) return this.detection;
    try {
      const { bank } = await this.loadBank();
      if (bank.size === 0) throw new Error("Hero portraits could not be downloaded (offline?)");
      this.detector ??= new EnemyDetector(bank);
      const res = this.detector.update(frames, s.team, s.hero.name);
      this.visionGrabs++;
      this.detection = { calibration: res.calibration, slots: res.enemySlots, lastAt: Date.now(), error: null };
      // Only grow the list; a later bad frame never removes a confirmed hero
      if (this.enemySource !== "manual" && res.enemies.length > this.enemies.length) {
        this.updateEnemies(res.enemies, "vision");
      }
    } catch (err) {
      this.detection = { ...this.detection, lastAt: Date.now(), error: (err as Error).message };
    }
    this.emit();
    return this.detection;
  }

  /**
   * Ask the overlay for one sharp set of portraits when the matcher is stuck: the rows are in the right place,
   * a few grabs have gone by, and some enemy slots still aren't confirmed (arcana/persona art). At most twice
   * per match, and only with AI on and a key set.
   */
  hiResWanted(): boolean {
    return Boolean(
      this.visionWanted() && this.detector && this.detection.calibration !== "bad" && this.detection.calibration !== null &&
        this.visionGrabs >= AI_VISION_AFTER_GRABS && this.detector.pending().length > 0 &&
        this.aiVisionTries < AI_VISION_MAX_TRIES && !this.identifying &&
        this.settings.get().ai.enabled && this.settings.hasCredentials(),
    );
  }

  /** Sharp portraits (PNG), 5 per side: the AI names the enemy slots the matcher couldn't, and they're learned */
  async ingestPortraits(pngs: Record<Side, Buffer[]>): Promise<{ identified: string[] }> {
    const s = this.snapshot;
    if (!this.hiResWanted() || !s?.hero || !s.team || !this.detector) return { identified: [] };
    this.identifying = true;
    this.aiVisionTries++;
    const identified: string[] = [];
    try {
      const detector = this.detector;
      const side = detector.enemySideFor(s.team);
      const pending = detector.pending();
      const ai = this.settings.get().ai;
      const names = await this.identify(pending.map((i) => pngs[side][i]), { model: ai.model, apiKey: this.settings.resolvedKey() });
      const { bank } = await this.loadBank();
      for (const [n, slot] of pending.entries()) {
        const hero = names[n];
        if (!hero || !getHero(hero) || this.detector !== detector) continue;
        if (!detector.confirmExternal(slot, hero, s.hero.name)) continue;
        identified.push(hero);
        // Learn this look so the matcher handles it alone next time
        try {
          const png = PNG.sync.read(pngs[side][slot]);
          bank.add(hero, fromRGBA(png.width, png.height, png.data));
          await this.persistLearned(hero, pngs[side][slot]);
        } catch (err) {
          console.warn("[vision] could not save a learned portrait:", (err as Error).message);
        }
      }
      if (identified.length) {
        console.log(`[vision] AI identified ${identified.map((h) => h.replace("npc_dota_hero_", "")).join(", ")}`);
        if (this.enemySource !== "manual") this.updateEnemies(detector.enemies(), "vision");
      }
    } catch (err) {
      console.warn("[vision] AI portrait identification failed:", (err as Error).message);
    } finally {
      this.identifying = false;
    }
    this.emit();
    return { identified };
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
      ai: advice ? { items: advice.next_items, skillPriority: advice.skill_priority, neutral: advice.neutral } : null,
      skipped: [...this.skipped],
      inTransit: this.inTransit,
      prefs: (() => {
        const c = this.settings.get().coach;
        return { lowHpPct: c.lowHpPct, goldAlert: c.goldAlert, timers: c.timers };
      })(),
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
      benchmark: this.benchmark(),
      purchases: this.purchases,
      rank: this.rank(),
      recentGames: this.recentGames(),
      draft: this.draft(),
      enemies: this.enemies,
      enemySource: this.enemySource,
      detection: { ...this.detection, wanted: this.visionWanted() },
      match: this.matchInfo(),
      matchLog: this.matchLogStatus(),
      // Public settings only: the API key itself never leaves the server
      settings: this.settings.get(),
      apiKey: this.settings.keyStatus(),
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
    const all = [...s.items.inventory, ...s.items.backpack, ...s.items.stash, ...(s.items.courier ?? []), s.items.teleport, s.items.neutral];
    for (const i of all) if (i) items[i.name] = getItem(i.name)?.name ?? i.name;
    for (const i of this.advisor.status().advice?.next_items ?? []) items[i.item] = getItem(i.item)?.name ?? i.item;
    for (const k of this.purchases.flatMap((p) => p.replaced)) items[k] = getItem(k)?.name ?? k;
    return { abilities, items };
  }
}
