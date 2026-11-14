// 맵 이벤트 주기. 패치마다 바뀌는 값이라 approx 로 표시하고, 한 곳에만 둔다.
import type { GameSnapshot } from "../gsi/normalize.js";
import type { TimerInfo } from "./types.js";

interface Periodic {
  id: string;
  label: string;
  first: number; // 첫 등장(게임 시계 초)
  every: number;
  approx: boolean;
  until?: number;
}

export const PERIODIC: Periodic[] = [
  { id: "bounty", label: "바운티 룬", first: 0, every: 180, approx: false },
  { id: "power", label: "파워 룬", first: 360, every: 120, approx: false },
  { id: "wisdom", label: "지혜 룬", first: 420, every: 420, approx: true },
  { id: "lotus", label: "연꽃", first: 180, every: 180, approx: true },
  { id: "daynight", label: "낮/밤 전환", first: 300, every: 300, approx: false },
];

export function nextOccurrence(clock: number, first: number, every: number): number {
  if (clock < first) return first;
  return first + Math.ceil((clock - first + 0.001) / every) * every;
}

export function buildTimers(s: GameSnapshot): TimerInfo[] {
  const clock = s.clockTime;
  const out: TimerInfo[] = PERIODIC.filter((p) => p.until === undefined || clock < p.until).map((p) => ({
    id: p.id,
    label: p.id === "daynight" ? (s.daytime ? "밤 시작" : "낮 시작") : p.label,
    inSeconds: Math.round(nextOccurrence(clock, p.first, p.every) - clock),
    approx: p.approx,
  }));

  // 중립 캠프 스택: 매 분 :53 즈음 끌어야 한다
  if (clock > 60) {
    const sec = ((clock % 60) + 60) % 60;
    const toStack = sec <= 53 ? 53 - sec : 113 - sec;
    out.push({ id: "stack", label: "캠프 스택 (x:53)", inSeconds: Math.round(toStack), approx: false });
  }

  if (s.roshan && s.roshan.state !== "alive" && s.roshan.endSeconds > 0) {
    out.push({
      id: "roshan",
      label: s.roshan.state === "respawn_variable" ? "로샨 부활 가능 구간 끝" : "로샨 최소 부활",
      inSeconds: Math.round(s.roshan.endSeconds),
      approx: s.roshan.state === "respawn_variable",
    });
  }

  return out.sort((a, b) => a.inSeconds - b.inSeconds);
}
