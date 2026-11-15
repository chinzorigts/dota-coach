// Map event intervals. Patch-dependent, so flagged approx and kept in one place.
import type { GameSnapshot } from "../gsi/normalize.js";
import type { TimerInfo } from "./types.js";

interface Periodic {
  id: string;
  label: string;
  first: number; // first spawn (game clock seconds)
  every: number;
  approx: boolean;
  until?: number;
}

export const PERIODIC: Periodic[] = [
  { id: "bounty", label: "Bounty rune", first: 0, every: 180, approx: false },
  { id: "power", label: "Power rune", first: 360, every: 120, approx: false },
  { id: "wisdom", label: "Wisdom rune", first: 420, every: 420, approx: true },
  { id: "lotus", label: "Lotus", first: 180, every: 180, approx: true },
  { id: "daynight", label: "Day/night", first: 300, every: 300, approx: false },
];

export function nextOccurrence(clock: number, first: number, every: number): number {
  if (clock < first) return first;
  return first + Math.ceil((clock - first + 0.001) / every) * every;
}

/** `enabled` maps timer id → shown; missing ids count as shown */
const KO: Record<string, string> = {
  bounty: "바운티 룬",
  power: "파워 룬",
  wisdom: "지혜 룬",
  lotus: "로터스",
};

export function buildTimers(s: GameSnapshot, enabled: Record<string, boolean> = {}, lang: "ko" | "en" = "en"): TimerInfo[] {
  const clock = s.clockTime;
  const ko = lang === "ko";
  const out: TimerInfo[] = PERIODIC.filter((p) => p.until === undefined || clock < p.until).map((p) => ({
    id: p.id,
    label: p.id === "daynight" ? (s.daytime ? (ko ? "밤 시작" : "Night falls") : ko ? "낮 시작" : "Day breaks") : ko ? (KO[p.id] ?? p.label) : p.label,
    inSeconds: Math.round(nextOccurrence(clock, p.first, p.every) - clock),
    approx: p.approx,
  }));

  // Neutral camp stack: pull around :53 every minute
  if (clock > 60) {
    const sec = ((clock % 60) + 60) % 60;
    const toStack = sec <= 53 ? 53 - sec : 113 - sec;
    out.push({ id: "stack", label: ko ? "캠프 스택 (x:53)" : "Stack camp (x:53)", inSeconds: Math.round(toStack), approx: false });
  }

  if (s.roshan && s.roshan.state !== "alive" && s.roshan.endSeconds > 0) {
    out.push({
      id: "roshan",
      label:
        s.roshan.state === "respawn_variable"
          ? ko ? "로샨 최대 부활" : "Roshan latest respawn"
          : ko ? "로샨 최소 부활" : "Roshan earliest respawn",
      inSeconds: Math.round(s.roshan.endSeconds),
      approx: s.roshan.state === "respawn_variable",
    });
  }

  return out.filter((t) => enabled[t.id] !== false).sort((a, b) => a.inSeconds - b.inSeconds);
}
