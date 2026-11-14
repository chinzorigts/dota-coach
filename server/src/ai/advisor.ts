import Anthropic from "@anthropic-ai/sdk";
import type { GameSnapshot } from "../gsi/normalize.js";
import { getItem, neutralTierOf } from "../data/constants.js";
import { neutralTier } from "../engine/neutral.js";
import type { CoachReport } from "../engine/types.js";
import { ADVICE_SCHEMA, SYSTEM_PROMPT, buildUserPayload } from "./prompt.js";

export interface AiAdvice {
  summary: string;
  danger: "low" | "medium" | "high";
  next_items: { item: string; reason: string }[];
  skill_priority: string[];
  tips: string[];
  /** Neutral item pick from the current tier's list */
  neutral?: { item: string; reason: string } | null;
  at: number; // Date.now()
  clock: number; // game clock
  reason: TriggerReason;
  question?: string;
}

export type TriggerReason = "hero" | "death" | "respawn" | "minute" | "neutral" | "enemies" | "purchase" | "manual";

/** What you bought instead of the suggestion, passed to the model so it can rebuild the plan */
export interface PurchaseNote {
  item: string;
  name: string;
  replaced: string[];
}

export interface AdvisorStatus {
  enabled: boolean;
  model: string;
  pending: TriggerReason | null;
  error: string | null;
  advice: AiAdvice | null;
  /** How long the last answer took, for the panel ("answered in 3.1s") */
  lastMs?: number;
}

/** The actual API call. Tests swap in a fake. */
export type AdviceCaller = (
  payload: unknown,
  reason?: TriggerReason,
) => Promise<Omit<AiAdvice, "at" | "clock" | "reason" | "question" | "neutral"> & { neutral_item?: string; neutral_reason?: string }>;

interface TriggerMemory {
  key: string | null; // matchId + hero
  deaths: number;
  minuteBucket: number;
  lastCallAt: number;
  /** Hero alive at the last update; a false -> true flip is a respawn */
  alive?: boolean;
  /** Neutral tier at the last call; a new tier needs a new pick */
  neutralTier?: number;
}

const BUCKET_SEC = 5 * 60;

export interface Triggers {
  hero: boolean;
  death: boolean;
  periodic: boolean;
  enemies: boolean;
  /** Optional so older callers/tests keep working; off only when explicitly false */
  purchase?: boolean;
  /** Fresh read the moment you respawn, so the HUD doesn't keep the advice from while you were dead */
  respawn?: boolean;
}
const ALL_TRIGGERS: Triggers = { hero: true, death: true, periodic: true, enemies: true, purchase: true, respawn: true };
/** Buying several things at the fountain shouldn't fire several requests */
const PURCHASE_MIN_GAP_SEC = 20;

/** Live AI settings, read on every decision so changes in the settings screen apply immediately */
export interface AiRuntime {
  enabled: boolean;
  model: string;
  minIntervalSec: number;
  triggers: Triggers;
}

/** Pure function deciding whether to auto-call (includes throttling). Disabled triggers never fire. */
export function decideTrigger(
  mem: TriggerMemory,
  s: GameSnapshot,
  now: number,
  minIntervalSec: number,
  triggers: Triggers = ALL_TRIGGERS,
): TriggerReason | null {
  if (!s.hero || !s.player) return null;
  const key = `${s.matchId ?? "local"}:${s.hero.name}`;
  const sinceLast = (now - mem.lastCallAt) / 1000;

  if (mem.key !== key) return triggers.hero ? "hero" : null;
  if (triggers.death && s.player.deaths > mem.deaths && sinceLast >= 30) return "death";
  if (triggers.respawn !== false && mem.alive === false && s.hero.alive && sinceLast >= 10) return "respawn";
  // A new neutral tier opened since the last read: its pick needs a fresh answer (follows the periodic toggle)
  if (triggers.periodic && mem.neutralTier !== undefined && neutralTier(s.clockTime) > mem.neutralTier && sinceLast >= 20) return "neutral";
  const bucket = Math.floor(Math.max(0, s.clockTime) / BUCKET_SEC);
  if (triggers.periodic && bucket > mem.minuteBucket && sinceLast >= minIntervalSec) return "minute";
  return null;
}

type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/** Client per API key, so saving a new key in the settings screen takes effect on the next call */
function clientFor(apiKey: string | null) {
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}

/** `cfg` gets the trigger, so automatic in-game calls can use a faster model than questions you type */
export function makeClaudeCaller(cfg: (reason?: TriggerReason) => { model: string; effort: EffortLevel; apiKey: string | null }): AdviceCaller {
  let cached: { key: string | null; client: Anthropic } | null = null;
  return async (payload, reason) => {
    const { model, effort, apiKey } = cfg(reason);
    if (!cached || cached.key !== apiKey) cached = { key: apiKey, client: clientFor(apiKey) };
    const client = cached.client;
    const response = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      // If a safety classifier declines, the API re-runs on a fallback model
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort, format: { type: "json_schema", schema: ADVICE_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    if (response.stop_reason === "refusal") {
      throw new Error("The model declined to answer");
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("The response was cut off (max_tokens)");
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return JSON.parse(text);
  };
}

/** Cheap credential check for the settings screen: looks up the model, generates nothing */
export async function testConnection(model: string, apiKey: string | null): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  try {
    const m = await clientFor(apiKey).models.retrieve(model);
    return { ok: true, model: m.display_name ?? model };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

export class Advisor {
  private mem: TriggerMemory = { key: null, deaths: 0, minuteBucket: -1, lastCallAt: 0 };
  private state: Omit<AdvisorStatus, "enabled" | "model">;
  private listeners = new Set<() => void>();

  constructor(
    private opts: {
      runtime: () => AiRuntime;
      call: AdviceCaller | null;
      now?: () => number;
    },
  ) {
    this.state = { pending: null, error: null, advice: null };
  }

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  private get enabled() {
    return this.opts.runtime().enabled && Boolean(this.opts.call);
  }

  status(): AdvisorStatus {
    const rt = this.opts.runtime();
    return { ...this.state, enabled: this.enabled, model: rt.model };
  }

  onChange(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }

  reset() {
    this.mem = { key: null, deaths: 0, minuteBucket: -1, lastCallAt: 0 };
    this.state = { ...this.state, advice: null, error: null };
    this.emit();
  }

  /** Called on every GSI update. Requests advice in the background when needed */
  onSnapshot(s: GameSnapshot, report: CoachReport, enemies: string[]): Promise<void> | null {
    if (!this.enabled || this.state.pending) return null;
    const rt = this.opts.runtime();
    const reason = decideTrigger(this.mem, s, this.now(), rt.minIntervalSec, rt.triggers);
    if (!reason && s.hero && s.player) {
      // Track deaths even without a trigger so the next death is detected
      this.mem.deaths = s.player.deaths;
      // Hero trigger off: still remember the match, or every other trigger would wait on it forever
      const key = `${s.matchId ?? "local"}:${s.hero.name}`;
      if (this.mem.key !== key) {
        this.mem = { key, deaths: s.player.deaths, minuteBucket: Math.floor(Math.max(0, s.clockTime) / BUCKET_SEC), lastCallAt: 0 };
      }
      // Alive/dead is tracked every update so a respawn is seen even when no call happened at the death
      this.mem.alive = s.hero.alive;
    }
    if (!reason) return null;
    return this.request(reason, s, report, enemies);
  }

  /** Re-ask when the enemy lineup changes, regardless of throttle (10s minimum) */
  onEnemiesChanged(s: GameSnapshot | null, report: CoachReport | null, enemies: string[]) {
    if (!this.enabled || !this.opts.runtime().triggers.enemies || this.state.pending || !s?.hero || !report) return null;
    if ((this.now() - this.mem.lastCallAt) / 1000 < 10) return null;
    return this.request("enemies", s, report, enemies);
  }

  /** Re-plan after you bought something other than what was suggested (20s minimum between calls) */
  onPurchase(s: GameSnapshot, report: CoachReport, enemies: string[], bought: PurchaseNote[]) {
    if (!this.enabled || this.opts.runtime().triggers.purchase === false || this.state.pending || !s.hero) return null;
    if ((this.now() - this.mem.lastCallAt) / 1000 < PURCHASE_MIN_GAP_SEC) return null;
    return this.request("purchase", s, report, enemies, undefined, bought);
  }

  ask(s: GameSnapshot, report: CoachReport, enemies: string[], question?: string) {
    if (!this.enabled) return Promise.reject(new Error("AI is off. Turn it on and add an API key in Settings"));
    if (this.state.pending) return Promise.reject(new Error("Already waiting for advice"));
    return this.request("manual", s, report, enemies, question);
  }

  private async request(
    reason: TriggerReason,
    s: GameSnapshot,
    report: CoachReport,
    enemies: string[],
    question?: string,
    bought?: PurchaseNote[],
  ) {
    this.mem = {
      key: s.hero ? `${s.matchId ?? "local"}:${s.hero.name}` : this.mem.key,
      deaths: s.player?.deaths ?? this.mem.deaths,
      minuteBucket: Math.floor(Math.max(0, s.clockTime) / BUCKET_SEC),
      lastCallAt: this.now(),
      alive: s.hero?.alive ?? this.mem.alive,
      neutralTier: neutralTier(s.clockTime),
    };
    this.state = { ...this.state, pending: reason, error: null };
    this.emit();
    try {
      const started = this.now();
      const raw = await this.opts.call!(buildUserPayload(s, report, enemies, question, bought), reason);
      this.state = { ...this.state, lastMs: this.now() - started };
      console.log(`[ai] ${reason} advice in ${((this.now() - started) / 1000).toFixed(1)}s`);
      this.state = {
        ...this.state,
        pending: null,
        advice: {
          summary: String(raw.summary ?? ""),
          danger: raw.danger ?? "low",
          // Drop item keys the model made up
          next_items: (raw.next_items ?? []).filter((i) => getItem(i.item)).slice(0, 4),
          skill_priority: raw.skill_priority ?? [],
          tips: (raw.tips ?? []).slice(0, 4),
          // Only a real neutral item key counts; the engine also checks it's from the current tier
          neutral: raw.neutral_item && neutralTierOf(raw.neutral_item) ? { item: raw.neutral_item, reason: String(raw.neutral_reason ?? "") } : null,
          at: this.now(),
          clock: s.clockTime,
          reason,
          question: question?.trim() || undefined,
        },
      };
    } catch (err) {
      this.state = { ...this.state, pending: null, error: describeError(err) };
    }
    this.emit();
  }
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Invalid API key";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited. Will retry shortly";
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}: ${err.message}`;
  if (err instanceof SyntaxError) return "Could not parse the AI response";
  return (err as Error)?.message ?? String(err);
}
