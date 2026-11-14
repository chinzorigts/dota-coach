// User settings, editable from the dashboard and applied live (no restart).
//
// Stored in <repo>/.data/settings.json. The API key lives in a separate secrets.json (mode 600) and is
// never sent to the browser: clients only learn whether a key is set and its last four characters.
// .env values seed the defaults, so an existing setup keeps working until something is changed in the UI.
import fs from "node:fs";
import path from "node:path";
import { config, ROOT_DIR } from "./config.js";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Sharpest reads; slower answers, highest cost" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Strong reads at about half the cost" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Quickest answers, lowest cost" },
] as const;
export const EFFORTS = ["low", "medium", "high"] as const;
export const TIMER_IDS = ["bounty", "power", "wisdom", "lotus", "daynight", "stack", "roshan"] as const;
export const OVERLAY_SECTIONS = ["item", "skill", "alerts", "enemies", "opponents", "timers", "ai", "benchmark", "rank", "draft"] as const;
/** Dota positions: 1 safe lane carry, 2 mid, 3 offlane, 4 soft support, 5 hard support. 0 = not set */
export const POSITIONS = [0, 1, 2, 3, 4, 5] as const;
export type Position = (typeof POSITIONS)[number];

export type Effort = (typeof EFFORTS)[number];
export type TimerId = (typeof TIMER_IDS)[number];
export type OverlaySection = (typeof OVERLAY_SECTIONS)[number];

export interface Settings {
  ai: {
    enabled: boolean;
    model: string;
    effort: Effort;
    autoIntervalSec: number;
    triggers: { hero: boolean; death: boolean; periodic: boolean; enemies: boolean };
  };
  coach: {
    defaultRole: "auto" | "core" | "support";
    lowHpPct: number;
    goldAlert: number;
    timers: Record<TimerId, boolean>;
  };
  overlay: {
    sections: Record<OverlaySection, boolean>;
    opacity: number;
    scale: number;
  };
  detection: { enabled: boolean };
  /** Lobby players from server_log.txt (see matchlog/parser.ts for why this is usually unavailable). "" = auto-detect */
  matchInfo: { enabled: boolean; logPath: string };
  /**
   * Your MMR as shown on your Dota profile. Valve doesn't expose it to GSI or OpenDota, so it's typed in once and
   * then nudged by perGame after each finished game when autoAdjust is on (GSI can't tell ranked from unranked).
   */
  rank: { mmr: number | null; autoAdjust: boolean; perGame: number };
  /** The position you play, for pick suggestions during the draft */
  draft: { position: Position };
}

export function defaultSettings(): Settings {
  const model = MODELS.some((m) => m.id === config.model) ? config.model : MODELS[0].id;
  const effort = (EFFORTS as readonly string[]).includes(config.effort) ? (config.effort as Effort) : "low";
  return {
    ai: {
      enabled: process.env.COACH_AI !== "off",
      model,
      effort,
      autoIntervalSec: clamp(config.aiMinIntervalSec, 30, 600),
      triggers: { hero: true, death: true, periodic: true, enemies: true },
    },
    coach: {
      defaultRole: "auto",
      lowHpPct: 25,
      goldAlert: 2000,
      timers: Object.fromEntries(TIMER_IDS.map((t) => [t, true])) as Record<TimerId, boolean>,
    },
    overlay: {
      sections: Object.fromEntries(OVERLAY_SECTIONS.map((s) => [s, true])) as Record<OverlaySection, boolean>,
      opacity: 0.84,
      scale: 1,
    },
    detection: { enabled: true },
    matchInfo: { enabled: true, logPath: "" },
    rank: { mmr: null, autoAdjust: true, perGame: 25 },
    draft: { position: 0 },
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const num = (v: unknown, d: number, lo: number, hi: number, step = 1) =>
  typeof v === "number" && Number.isFinite(v) ? clamp(Math.round(v / step) * step, lo, hi) : d;
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : d;
const str = (v: unknown, d: string, max: number) => (typeof v === "string" && v.length <= max ? v.trim() : d);
const flags = <K extends string>(v: unknown, keys: readonly K[], d: Record<K, boolean>) =>
  Object.fromEntries(keys.map((k) => [k, bool(isObj(v) ? v[k] : undefined, d[k])])) as Record<K, boolean>;

/** Applies a partial update on top of `base`. Invalid or unknown fields are ignored, numbers are clamped. */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  const p = isObj(patch) ? patch : {};
  const ai = isObj(p.ai) ? p.ai : {};
  const coach = isObj(p.coach) ? p.coach : {};
  const overlay = isObj(p.overlay) ? p.overlay : {};
  const detection = isObj(p.detection) ? p.detection : {};
  const matchInfo = isObj(p.matchInfo) ? p.matchInfo : {};
  const rank = isObj(p.rank) ? p.rank : {};
  const draft = isObj(p.draft) ? p.draft : {};
  return {
    ai: {
      enabled: bool(ai.enabled, base.ai.enabled),
      model: oneOf(ai.model, MODELS.map((m) => m.id), base.ai.model as (typeof MODELS)[number]["id"]),
      effort: oneOf(ai.effort, EFFORTS, base.ai.effort),
      autoIntervalSec: num(ai.autoIntervalSec, base.ai.autoIntervalSec, 30, 600, 5),
      triggers: flags(ai.triggers, ["hero", "death", "periodic", "enemies"] as const, base.ai.triggers),
    },
    coach: {
      defaultRole: oneOf(coach.defaultRole, ["auto", "core", "support"] as const, base.coach.defaultRole),
      lowHpPct: num(coach.lowHpPct, base.coach.lowHpPct, 5, 60),
      goldAlert: num(coach.goldAlert, base.coach.goldAlert, 500, 10000, 100),
      timers: flags(coach.timers, TIMER_IDS, base.coach.timers),
    },
    overlay: {
      sections: flags(overlay.sections, OVERLAY_SECTIONS, base.overlay.sections),
      opacity: num(overlay.opacity, base.overlay.opacity, 0.3, 1, 0.01),
      scale: num(overlay.scale, base.overlay.scale, 0.8, 1.5, 0.05),
    },
    detection: { enabled: bool(detection.enabled, base.detection.enabled) },
    matchInfo: {
      enabled: bool(matchInfo.enabled, base.matchInfo.enabled),
      logPath: str(matchInfo.logPath, base.matchInfo.logPath, 1000),
    },
    rank: {
      // null clears it; a number must be a plausible MMR
      mmr:
        rank.mmr === null
          ? null
          : typeof rank.mmr === "number" && Number.isFinite(rank.mmr)
            ? clamp(Math.round(rank.mmr), 0, 15000)
            : base.rank.mmr,
      autoAdjust: bool(rank.autoAdjust, base.rank.autoAdjust),
      perGame: num(rank.perGame, base.rank.perGame, 5, 60),
    },
    draft: {
      position: (POSITIONS as readonly unknown[]).includes(draft.position) ? (draft.position as Position) : base.draft.position,
    },
  };
}

export type KeySource = "settings" | "env" | "none";

export class SettingsStore {
  private current: Settings;
  private apiKey: string | null;
  private listeners = new Set<() => void>();

  constructor(private dir: string | null = path.join(ROOT_DIR, ".data")) {
    this.current = mergeSettings(defaultSettings(), this.read("settings.json"));
    const secrets = this.read("secrets.json");
    this.apiKey = isObj(secrets) && typeof secrets.anthropicApiKey === "string" ? secrets.anthropicApiKey : null;
  }

  private read(file: string): unknown {
    if (!this.dir) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, file), "utf8"));
    } catch {
      return null;
    }
  }

  private write(file: string, data: unknown, mode?: number) {
    if (!this.dir) return; // in-memory (tests)
    fs.mkdirSync(this.dir, { recursive: true });
    const target = path.join(this.dir, file);
    fs.writeFileSync(target, JSON.stringify(data, null, 2), mode ? { mode } : undefined);
    if (mode) fs.chmodSync(target, mode);
  }

  get(): Settings {
    return this.current;
  }

  /** Small state files next to settings.json (e.g. rank history). In-memory when there is no data dir. */
  private extra = new Map<string, unknown>();
  loadData(file: string): unknown {
    return this.dir ? this.read(file) : (this.extra.get(file) ?? null);
  }
  saveData(file: string, data: unknown) {
    if (this.dir) this.write(file, data);
    else this.extra.set(file, data);
  }

  update(patch: unknown): Settings {
    this.current = mergeSettings(this.current, patch);
    this.write("settings.json", this.current);
    this.emit();
    return this.current;
  }

  reset(): Settings {
    this.current = defaultSettings();
    this.write("settings.json", this.current);
    this.emit();
    return this.current;
  }

  /** Key saved in the UI wins over .env */
  resolvedKey(): string | null {
    return this.apiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
  }

  keyStatus(): { source: KeySource; last4: string | null } {
    const key = this.resolvedKey();
    const source: KeySource = this.apiKey ? "settings" : process.env.ANTHROPIC_API_KEY ? "env" : "none";
    // ANTHROPIC_AUTH_TOKEN (OAuth) also works with the SDK; report it as env without revealing anything
    if (source === "none" && process.env.ANTHROPIC_AUTH_TOKEN) return { source: "env", last4: null };
    return { source, last4: key ? key.slice(-4) : null };
  }

  hasCredentials(): boolean {
    return Boolean(this.resolvedKey() || process.env.ANTHROPIC_AUTH_TOKEN);
  }

  setApiKey(key: string | null) {
    this.apiKey = key?.trim() || null;
    this.write("secrets.json", { anthropicApiKey: this.apiKey }, 0o600);
    this.emit();
  }

  onChange(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }
}
