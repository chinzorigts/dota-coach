import type { GameSnapshot } from "../gsi/normalize.js";
import type { Alert, ItemRec } from "./types.js";

export interface AlertPrefs {
  lowHpPct: number;
  goldAlert: number;
}
const DEFAULT_PREFS: AlertPrefs = { lowHpPct: 25, goldAlert: 2000 };

export function buildAlerts(s: GameSnapshot, unspent: number, items: ItemRec[], prefs: AlertPrefs = DEFAULT_PREFS): Alert[] {
  const out: Alert[] = [];
  const h = s.hero;
  const p = s.player;
  if (!h || !p) return out;

  if (h.alive && h.healthPct > 0 && h.healthPct <= prefs.lowHpPct) {
    out.push({ id: "low-hp", level: "danger", text: `HP ${h.healthPct}%. Back off or heal` });
  } else if (h.alive && h.healthPct <= prefs.lowHpPct + 20) {
    out.push({ id: "mid-hp", level: "warn", text: `HP ${h.healthPct}%. Avoid risky fights` });
  }

  if (h.alive && h.maxMana > 0 && h.manaPct <= 15) {
    out.push({ id: "low-mana", level: "warn", text: `Mana ${h.manaPct}%. Almost out of spells` });
  }

  if (!h.alive) {
    const canBuyback = h.buybackCooldown <= 0 && p.gold >= h.buybackCost && h.buybackCost > 0;
    out.push({
      id: "dead",
      level: "info",
      text: `Respawn in ${h.respawnSeconds}s${canBuyback ? `. Buyback available (${h.buybackCost} gold)` : ""}`,
    });
  }

  if (unspent > 0) {
    out.push({ id: "unspent", level: "warn", text: `${unspent} unspent ability point${unspent > 1 ? "s" : ""}` });
  }

  const affordable = items.filter((i) => i.affordable && i.key !== "tpscroll");
  if (p.gold >= prefs.goldAlert && affordable.length > 0 && s.clockTime > 0) {
    out.push({
      id: "gold",
      level: "info",
      text: `${p.gold} gold. You can buy ${affordable[0].name} now`,
    });
  }

  // Late game: buying the next item would leave no buyback gold
  if (s.clockTime >= 30 * 60 && h.buybackCost > 0 && h.buybackCooldown <= 0) {
    const next = affordable[0];
    if (next && p.gold - next.remaining < h.buybackCost) {
      out.push({
        id: "buyback-reserve",
        level: "warn",
        text: `Buying ${next.name} leaves you short of buyback (${h.buybackCost})`,
      });
    }
  }

  if (!s.items.teleport && s.clockTime > 0) {
    out.push({ id: "no-tp", level: "warn", text: "No TP scroll" });
  }

  if (h.disabled.length) {
    out.push({ id: "disabled", level: "danger", text: `Disabled: ${h.disabled.join(", ")}` });
  }

  return out;
}
