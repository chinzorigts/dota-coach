import type { RawGsi } from "./gsi/types.js";
import { normalize, type GameSnapshot } from "./gsi/normalize.js";
import { getAbility, getHero, getItem } from "./data/constants.js";
import { getItemPopularity, getPlayerSummary, type ItemPopularity, type PlayerSummary } from "./data/opendota.js";
import type { LobbyInfo, TeamSide } from "./matchlog/parser.js";
import type { WatcherStatus } from "./matchlog/watcher.js";
import { buildReport, type CoachReport, type RolePref } from "./engine/index.js";
import type { Advisor } from "./ai/advisor.js";
import { EnemyDetector, type DetectionResult, type Side, type SlotResult } from "./vision/detector.js";
import type { RGBImage } from "./vision/image.js";
import type { TemplateBank } from "./vision/matcher.js";
import { getTemplateBank } from "./vision/templates.js";
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

  constructor(
    private advisor: Advisor,
    private loadPopularity: (heroId: number) => Promise<ItemPopularity | null> = getItemPopularity,
    private loadBank: () => Promise<{ bank: TemplateBank }> = getTemplateBank,
    readonly settings: SettingsStore = new SettingsStore(null),
    private loadPlayer: (accountId: number) => Promise<PlayerSummary | null> = getPlayerSummary,
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
      this.detection = emptyDetection();
      this.advisor.reset();
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

    this.snapshot = snap;
    this.applyGsiLineup(snap);
    this.recompute();
    if (this.snapshot && this.report) {
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

  /** From the UI. Clearing the list hands control back to auto-detection. */
  setEnemies(heroes: string[]) {
    const valid = [...new Set(heroes)].filter((h) => getHero(h)).slice(0, 5);
    if (valid.length === 0) {
      this.detector?.reset();
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
        this.enemySource !== "manual" && this.enemySource !== "gsi" && this.enemies.length < 5,
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
      ai: advice ? { items: advice.next_items, skillPriority: advice.skill_priority } : null,
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
    const all = [...s.items.inventory, ...s.items.backpack, ...s.items.stash, s.items.teleport, s.items.neutral];
    for (const i of all) if (i) items[i.name] = getItem(i.name)?.name ?? i.name;
    for (const i of this.advisor.status().advice?.next_items ?? []) items[i.item] = getItem(i.item)?.name ?? i.item;
    return { abilities, items };
  }
}
