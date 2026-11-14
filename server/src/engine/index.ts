import type { GameSnapshot } from "../gsi/normalize.js";
import { getItem } from "../data/constants.js";
import type { ItemPopularity } from "../data/opendota.js";
import { buildAlerts, type AlertPrefs } from "./alerts.js";
import { inferRole, ownedItems, phaseOf, recommendItems } from "./items.js";
import { recommendSkill } from "./skills.js";
import { buildTimers } from "./timers.js";
import type { CoachReport, RolePref } from "./types.js";

export interface EngineContext {
  rolePref: RolePref;
  popularity: ItemPopularity | null;
  enemies: string[];
  ai: { items: { item: string; reason: string }[]; skillPriority: string[] } | null;
  /** From the settings screen; defaults apply when absent */
  prefs?: AlertPrefs & { timers: Record<string, boolean> };
}

export function buildReport(s: GameSnapshot, ctx: EngineContext): CoachReport {
  const role = ctx.rolePref === "auto" ? inferRole(s.hero?.name) : ctx.rolePref;
  const items = recommendItems(s, {
    role,
    popularity: ctx.popularity,
    enemies: ctx.enemies,
    aiItems: ctx.ai?.items ?? [],
  });
  const skills = recommendSkill(s, ctx.ai?.skillPriority ?? null);
  const p = s.player;
  const minutes = Math.max(s.clockTime / 60, 1 / 60);
  const itemValue = ownedItems(s).reduce(
    (sum, k) => sum + (getItem(k)?.cost ?? 0),
    0,
  );

  return {
    phase: phaseOf(s.clockTime),
    role,
    stats: {
      kda: p ? `${p.kills}/${p.deaths}/${p.assists}` : "-",
      kdaRatio: p ? +((p.kills + p.assists) / Math.max(1, p.deaths)).toFixed(2) : 0,
      lhPerMin: p && s.clockTime > 0 ? +(p.lastHits / minutes).toFixed(1) : 0,
      netWorth: (p?.gold ?? 0) + itemValue,
    },
    items,
    skills,
    alerts: buildAlerts(s, skills.unspent, items, ctx.prefs),
    timers: buildTimers(s, ctx.prefs?.timers),
  };
}

export type { CoachReport, RolePref } from "./types.js";
