export type Role = "core" | "support";
export type RolePref = Role | "auto";

export interface ItemRec {
  key: string;
  name: string;
  img: string;
  cost: number;
  remaining: number;
  affordable: boolean;
  reason: string;
  source: "meta" | "counter" | "ai" | "rule";
  priority: number; // 높을수록 위
}

export interface SkillRec {
  kind: "ability" | "talent";
  key: string;
  name: string;
  reason: string;
  /** talent 일 때 같은 티어의 두 선택지 */
  options?: { key: string; name: string }[];
}

export interface Alert {
  id: string;
  level: "info" | "warn" | "danger";
  text: string;
}

export interface TimerInfo {
  id: string;
  label: string;
  inSeconds: number;
  approx: boolean;
}

export interface CoachReport {
  phase: "pre" | "early" | "mid" | "late";
  role: Role;
  stats: {
    kda: string;
    kdaRatio: number;
    lhPerMin: number;
    netWorth: number;
  };
  items: ItemRec[];
  skills: {
    unspent: number;
    next: SkillRec | null;
    priority: string[];
    prioritySource: "ai" | "default";
  };
  alerts: Alert[];
  timers: TimerInfo[];
}
