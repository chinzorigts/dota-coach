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
  priority: number; // higher ranks first
}

export interface SkillRec {
  kind: "ability" | "talent";
  key: string;
  name: string;
  reason: string;
  /** For talents: the two options in the tier */
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
    /** What to take at your next level-up, when no point is waiting now */
    upcoming: (SkillRec & { atLevel: number }) | null;
    priority: string[];
    prioritySource: "ai" | "default";
  };
  alerts: Alert[];
  timers: TimerInfo[];
  /** Neutral item tier open now and the pick for it */
  neutral: import("./neutral.js").NeutralView | null;
}
