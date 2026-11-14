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
  player: { name: string; kills: number; deaths: number; assists: number; lastHits: number; denies: number; gold: number; gpm: number; xpm: number } | null;
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
  skills: { unspent: number; next: SkillRec | null; priority: string[]; prioritySource: "ai" | "default" };
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
  reason: "hero" | "death" | "minute" | "enemies" | "manual";
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
  rolePref: "auto" | "core" | "support";
  popularitySource: "opendota" | "default";
  names: { abilities: Record<string, string>; items: Record<string, string> };
  ai: { enabled: boolean; model: string; pending: AiAdvice["reason"] | null; error: string | null; advice: AiAdvice | null };
}

export interface HeroListItem { name: string; localizedName: string; icon: string; img: string; roles: string[] }
