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
export function buildTimers(s: GameSnapshot, enabled: Record<string, boolean> = {}): TimerInfo[] {
  const clock = s.clockTime;
  const out: TimerInfo[] = PERIODIC.filter((p) => p.until === undefined || clock < p.until).map((p) => ({
    id: p.id,
    label: p.id === "daynight" ? (s.daytime ? "Night falls" : "Day breaks") : p.label,
    inSeconds: Math.round(nextOccurrence(clock, p.first, p.every) - clock),
    approx: p.approx,
  }));

  // Neutral camp stack: pull around :53 every minute
  if (clock > 60) {
    const sec = ((clock % 60) + 60) % 60;
    const toStack = sec <= 53 ? 53 - sec : 113 - sec;
    out.push({ id: "stack", label: "Stack camp (x:53)", inSeconds: Math.round(toStack), approx: false });
  }

  if (s.roshan && s.roshan.state !== "alive" && s.roshan.endSeconds > 0) {
    out.push({
      id: "roshan",
      label: s.roshan.state === "respawn_variable" ? "Roshan latest respawn" : "Roshan earliest respawn",
      inSeconds: Math.round(s.roshan.endSeconds),
      approx: s.roshan.state === "respawn_variable",
    });
  }

  return out.filter((t) => enabled[t.id] !== false).sort((a, b) => a.inSeconds - b.inSeconds);
}
