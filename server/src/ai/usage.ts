/**
 * Counts what the AI calls cost: tokens per call, summed for this match and since the server started, with
 * an approximate price. Prices are the first-party API list rates per million tokens (input / output) and
 * may change; cache reads/writes are priced at 0.1x / 1.25x input.
 */
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "claude-fable-5-2": { in: 8, out: 40 },
};

export type UsageKind = "advice" | "review" | "vision";

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  byKind: Partial<Record<UsageKind, number>>;
}

export interface UsageView {
  match: UsageTotals;
  session: UsageTotals;
  /** False when a model had no known price, so the dollar figure undercounts */
  priced: boolean;
}

interface RawUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

const empty = (): UsageTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, byKind: {} });

let match = empty();
let session = empty();
let priced = true;
const listeners = new Set<() => void>();

export function costOf(model: string, u: RawUsage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) * 0.1 + (u.cache_creation_input_tokens ?? 0) * 1.25;
  return (input * p.in + (u.output_tokens ?? 0) * p.out) / 1_000_000;
}

export function recordUsage(kind: UsageKind, model: string, u: RawUsage | null | undefined) {
  if (!u) return;
  const cost = costOf(model, u);
  if (cost === null) priced = false;
  const inTok = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  for (const t of [match, session]) {
    t.calls++;
    t.inputTokens += inTok;
    t.outputTokens += u.output_tokens ?? 0;
    t.usd += cost ?? 0;
    t.byKind[kind] = (t.byKind[kind] ?? 0) + 1;
  }
  for (const l of listeners) l();
}

export function resetMatchUsage() {
  match = empty();
}

export function usageView(): UsageView {
  return { match: { ...match, byKind: { ...match.byKind } }, session: { ...session, byKind: { ...session.byKind } }, priced };
}

export function onUsage(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
