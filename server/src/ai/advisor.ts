import Anthropic from "@anthropic-ai/sdk";
import type { GameSnapshot } from "../gsi/normalize.js";
import { getItem } from "../data/constants.js";
import type { CoachReport } from "../engine/types.js";
import { ADVICE_SCHEMA, SYSTEM_PROMPT, buildUserPayload } from "./prompt.js";

export interface AiAdvice {
  summary: string;
  danger: "low" | "medium" | "high";
  next_items: { item: string; reason: string }[];
  skill_priority: string[];
  tips: string[];
  at: number; // Date.now()
  clock: number; // 게임 시계
  reason: TriggerReason;
  question?: string;
}

export type TriggerReason = "hero" | "death" | "minute" | "enemies" | "manual";

export interface AdvisorStatus {
  enabled: boolean;
  model: string;
  pending: TriggerReason | null;
  error: string | null;
  advice: AiAdvice | null;
}

/** 실제 API 호출. 테스트에서는 가짜로 바꿔 끼운다. */
export type AdviceCaller = (payload: unknown) => Promise<Omit<AiAdvice, "at" | "clock" | "reason" | "question">>;

interface TriggerMemory {
  key: string | null; // matchId + hero
  deaths: number;
  minuteBucket: number;
  lastCallAt: number;
}

const BUCKET_SEC = 5 * 60;

/** 자동 호출 여부만 판단하는 순수 함수 (쓰로틀 포함) */
export function decideTrigger(
  mem: TriggerMemory,
  s: GameSnapshot,
  now: number,
  minIntervalSec: number,
): TriggerReason | null {
  if (!s.hero || !s.player) return null;
  const key = `${s.matchId ?? "local"}:${s.hero.name}`;
  const sinceLast = (now - mem.lastCallAt) / 1000;

  if (mem.key !== key) return "hero";
  if (s.player.deaths > mem.deaths && sinceLast >= 30) return "death";
  const bucket = Math.floor(Math.max(0, s.clockTime) / BUCKET_SEC);
  if (bucket > mem.minuteBucket && sinceLast >= minIntervalSec) return "minute";
  return null;
}

export function makeClaudeCaller(model: string, effort: "low" | "medium" | "high" | "xhigh" | "max"): AdviceCaller {
  const client = new Anthropic();
  return async (payload) => {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      // 안전 분류기가 거절하면 서버가 다른 모델로 다시 돌린다
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort, format: { type: "json_schema", schema: ADVICE_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    if (response.stop_reason === "refusal") {
      throw new Error("모델이 응답을 거절했습니다");
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("응답이 잘렸습니다 (max_tokens)");
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return JSON.parse(text);
  };
}

export class Advisor {
  private mem: TriggerMemory = { key: null, deaths: 0, minuteBucket: -1, lastCallAt: 0 };
  private state: AdvisorStatus;
  private listeners = new Set<() => void>();

  constructor(
    private opts: {
      enabled: boolean;
      model: string;
      minIntervalSec: number;
      call: AdviceCaller | null;
      now?: () => number;
    },
  ) {
    this.state = { enabled: opts.enabled && !!opts.call, model: opts.model, pending: null, error: null, advice: null };
  }

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  status(): AdvisorStatus {
    return this.state;
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

  /** GSI 업데이트마다 호출. 필요하면 백그라운드로 조언을 요청한다 */
  onSnapshot(s: GameSnapshot, report: CoachReport, enemies: string[]): Promise<void> | null {
    if (!this.state.enabled || this.state.pending) return null;
    const reason = decideTrigger(this.mem, s, this.now(), this.opts.minIntervalSec);
    // 트리거가 없어도 데스 수는 따라가야 다음 데스를 감지한다
    if (s.player && !reason) this.mem.deaths = s.player.deaths;
    if (!reason) return null;
    return this.request(reason, s, report, enemies);
  }

  /** 적 조합이 바뀌면 쓰로틀과 무관하게(최소 10초) 다시 묻는다 */
  onEnemiesChanged(s: GameSnapshot | null, report: CoachReport | null, enemies: string[]) {
    if (!this.state.enabled || this.state.pending || !s?.hero || !report) return null;
    if ((this.now() - this.mem.lastCallAt) / 1000 < 10) return null;
    return this.request("enemies", s, report, enemies);
  }

  ask(s: GameSnapshot, report: CoachReport, enemies: string[], question?: string) {
    if (!this.state.enabled) return Promise.reject(new Error("AI 가 꺼져 있습니다 (ANTHROPIC_API_KEY 확인)"));
    if (this.state.pending) return Promise.reject(new Error("이미 조언을 기다리는 중입니다"));
    return this.request("manual", s, report, enemies, question);
  }

  private async request(
    reason: TriggerReason,
    s: GameSnapshot,
    report: CoachReport,
    enemies: string[],
    question?: string,
  ) {
    this.mem = {
      key: s.hero ? `${s.matchId ?? "local"}:${s.hero.name}` : this.mem.key,
      deaths: s.player?.deaths ?? this.mem.deaths,
      minuteBucket: Math.floor(Math.max(0, s.clockTime) / BUCKET_SEC),
      lastCallAt: this.now(),
    };
    this.state = { ...this.state, pending: reason, error: null };
    this.emit();
    try {
      const raw = await this.opts.call!(buildUserPayload(s, report, enemies, question));
      this.state = {
        ...this.state,
        pending: null,
        advice: {
          summary: String(raw.summary ?? ""),
          danger: raw.danger ?? "low",
          // 모델이 없는 키를 지어내면 버린다
          next_items: (raw.next_items ?? []).filter((i) => getItem(i.item)).slice(0, 4),
          skill_priority: raw.skill_priority ?? [],
          tips: (raw.tips ?? []).slice(0, 4),
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
  if (err instanceof Anthropic.AuthenticationError) return "API 키가 유효하지 않습니다";
  if (err instanceof Anthropic.RateLimitError) return "요청 한도 초과 — 잠시 후 다시 시도됩니다";
  if (err instanceof Anthropic.APIError) return `API 오류 ${err.status ?? ""}: ${err.message}`;
  if (err instanceof SyntaxError) return "AI 응답을 해석하지 못했습니다";
  return (err as Error)?.message ?? String(err);
}
