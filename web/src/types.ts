// Shape of the server's /api/state (keep in sync with server/src/state.ts toJSON)
export interface ItemState { slot: string; name: string; charges?: number; cooldown: number }
export interface AbilityState { slot: number; name: string; level: number; canCast: boolean; passive: boolean; cooldown: number; ultimate: boolean }

export interface Snapshot {
  receivedAt: number;
  matchId: string | null;
  gameState: string;
  inProgress: boolean;
  clockTime: number;
  daytime: boolean;
  paused: boolean;
  team: "radiant" | "dire" | null;
  score: { radiant: number; dire: number };
  player: { name: string; accountId: number | null; kills: number; deaths: number; assists: number; lastHits: number; denies: number; gold: number; gpm: number; xpm: number } | null;
  hero: {
    id: number; name: string; level: number; alive: boolean; respawnSeconds: number; buybackCost: number; buybackCooldown: number;
    health: number; maxHealth: number; healthPct: number; mana: number; maxMana: number; manaPct: number;
    aghsScepter: boolean; aghsShard: boolean; talents: boolean[];
  } | null;
  abilities: AbilityState[];
  items: { inventory: ItemState[]; backpack: ItemState[]; stash: ItemState[]; teleport: ItemState | null; neutral: ItemState | null };
}

export interface ItemRec { key: string; name: string; img: string; cost: number; remaining: number; affordable: boolean; reason: string; source: "meta" | "counter" | "ai" | "rule"; priority: number }
export interface SkillRec { kind: "ability" | "talent"; key: string; name: string; reason: string; options?: { key: string; name: string }[] }
export interface Alert { id: string; level: "info" | "warn" | "danger"; text: string }
export interface TimerInfo { id: string; label: string; inSeconds: number; approx: boolean }

export interface Report {
  phase: "pre" | "early" | "mid" | "late";
  role: "core" | "support";
  stats: { kda: string; kdaRatio: number; lhPerMin: number; netWorth: number };
  items: ItemRec[];
  skills: { unspent: number; next: SkillRec | null; upcoming: (SkillRec & { atLevel: number }) | null; priority: string[]; prioritySource: "ai" | "default" };
  alerts: Alert[];
  timers: TimerInfo[];
}

export interface AiAdvice {
  summary: string;
  danger: "low" | "medium" | "high";
  next_items: { item: string; reason: string }[];
  skill_priority: string[];
  tips: string[];
  at: number;
  clock: number;
  reason: "hero" | "death" | "respawn" | "minute" | "enemies" | "purchase" | "manual";
  question?: string;
}

export interface CoachState {
  serverTime: number;
  lastGsiAt: number;
  snapshot: Snapshot | null;
  heroInfo: { localizedName: string; img: string; icon: string; roles: string[] } | null;
  report: Report | null;
  enemies: string[];
  enemySource: "none" | "manual" | "gsi" | "vision";
  detection: {
    wanted: boolean;
    calibration: "ok" | "swapped" | "unverified" | "bad" | null;
    slots: { hero: string | null; score: number; confirmed: string | null }[];
    lastAt: number;
    error: string | null;
  };
  benchmark: BenchmarkView | null;
  /** What you bought this match; followed = it was on the list */
  purchases: Purchase[];
  rank: RankView;
  draft: DraftView | null;
  match: MatchInfo | null;
  matchLog: { path: string | null; exists: boolean; lastLobbyAt: number | null; error: string | null } | null;
  rolePref: "auto" | "core" | "support";
  settings: Settings;
  apiKey: ApiKeyStatus;
  popularitySource: "opendota" | "default";
  names: { abilities: Record<string, string>; items: Record<string, string> };
  ai: { enabled: boolean; model: string; pending: AiAdvice["reason"] | null; error: string | null; advice: AiAdvice | null; lastMs?: number };
}

export interface Settings {
  ai: {
    enabled: boolean;
    model: string;
    liveModel: string;
    effort: "low" | "medium" | "high";
    autoIntervalSec: number;
    triggers: { hero: boolean; death: boolean; respawn: boolean; periodic: boolean; enemies: boolean; purchase: boolean };
  };
  coach: {
    defaultRole: "auto" | "core" | "support";
    lowHpPct: number;
    goldAlert: number;
    timers: Record<string, boolean>;
  };
  overlay: { sections: Record<string, boolean>; opacity: number; scale: number; sound: boolean; soundVolume: number };
  detection: { enabled: boolean };
  matchInfo: { enabled: boolean; logPath: string };
  rank: { mmr: number | null; autoAdjust: boolean; perGame: number };
  draft: { position: Position };
}

// Keep in sync with server/src/engine/purchases.ts
export interface Purchase { item: string; name: string; clock: number; followed: boolean; replaced: string[] }

/** 1 safe lane carry, 2 mid, 3 offlane, 4 soft support, 5 hard support; 0 = not set */
export type Position = 0 | 1 | 2 | 3 | 4 | 5;

// Keep in sync with server/src/engine/benchmarks.ts
export interface StatRow {
  key: "kills" | "deaths" | "assists" | "lastHits" | "denies" | "gpm" | "xpm";
  label: string;
  value: number;
  heroMedian: number | null;
  heroPercentile: number | null;
  personal: number | null;
  better: "higher" | "lower";
  verdict: "good" | "ok" | "bad" | null;
}

export interface BenchmarkView {
  minute: number;
  early: boolean;
  rows: StatRow[];
  killParticipation: number | null;
  hero: "ok" | "loading" | "none";
  personal: "ok" | "loading" | "none";
  personalGames: number | null;
}

// Keep in sync with server/src/engine/rank.ts
export interface RankTarget { label: string; mmr: number; remaining: number; wins: number }
export interface RankView {
  source: "mmr" | "estimate" | "medal" | "none";
  approximate: boolean;
  mmr: number | null;
  label: string | null;
  medal: string | null;
  stars: number | null;
  openDotaLabel: string | null;
  nextStar: RankTarget | null;
  nextMedal: RankTarget | null;
  progress: number | null;
  perGame: number;
  lastChange: { delta: number; matchId: string; at: number } | null;
  estimated: true;
}

// Keep in sync with server/src/engine/draft.ts
export interface PickSuggestion {
  hero: string;
  name: string;
  icon: string;
  score: number;
  winRate: number | null;
  fit: number;
  reasons: { enemy: string; advantage: number }[];
}
export interface DraftView {
  position: Position;
  enemies: string[];
  status: "ok" | "loading" | "no-data";
  bracket: number | null;
  suggestions: PickSuggestion[];
}

export interface MatchPlayer {
  slot: number;
  accountId: number;
  isMe: boolean;
  party: number | null;
  status: "loading" | "ok" | "failed";
  stats: {
    name: string | null;
    rank: string | null;
    rankTier: number | null;
    recent: { games: number; wins: number; losses: number; winRate: number | null } | null;
    topHeroes: { heroId: number; name: string | null; games: number; wins: number }[];
    isPrivate: boolean;
  } | null;
}

/** Lobby players from server_log.txt. No region/ping: the game doesn't expose them (see server/src/state.ts). */
export interface MatchInfo {
  lobbyId: string;
  gameMode: string;
  detectedAt: number | null;
  myTeam: "radiant" | "dire" | null;
  allies: MatchPlayer[];
  enemies: MatchPlayer[];
}

export interface ApiKeyStatus {
  source: "settings" | "env" | "none";
  last4: string | null;
}

export interface SettingsView {
  settings: Settings;
  apiKey: ApiKeyStatus;
  canEdit: boolean;
  options: {
    models: { id: string; label: string; note: string }[];
    efforts: string[];
    timers: string[];
    overlaySections: string[];
  };
}

export interface HeroListItem { name: string; localizedName: string; icon: string; img: string; roles: string[] }
