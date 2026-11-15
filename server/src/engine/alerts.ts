import type { GameSnapshot } from "../gsi/normalize.js";
import type { Alert, ItemRec } from "./types.js";

export interface AlertPrefs {
  lowHpPct: number;
  goldAlert: number;
  lang?: "ko" | "en";
}
const DEFAULT_PREFS: AlertPrefs = { lowHpPct: 25, goldAlert: 2000 };

export function buildAlerts(s: GameSnapshot, unspent: number, items: ItemRec[], prefs: AlertPrefs = DEFAULT_PREFS): Alert[] {
  const out: Alert[] = [];
  const h = s.hero;
  const p = s.player;
  if (!h || !p) return out;
  const ko = prefs.lang === "ko";

  // HP 0% with alive=true is the frame where the hero just died and GSI hasn't flipped `alive` yet: no HP alert
  if (h.alive && h.healthPct > 0 && h.healthPct <= prefs.lowHpPct) {
    out.push({ id: "low-hp", level: "danger", text: ko ? `체력 ${h.healthPct}%. 물러나거나 회복하세요` : `HP ${h.healthPct}%. Back off or heal` });
  } else if (h.alive && h.healthPct > 0 && h.healthPct <= prefs.lowHpPct + 20) {
    out.push({ id: "mid-hp", level: "warn", text: ko ? `체력 ${h.healthPct}%. 위험한 싸움은 피하세요` : `HP ${h.healthPct}%. Avoid risky fights` });
  }

  if (h.alive && h.maxMana > 0 && h.manaPct <= 15) {
    out.push({ id: "low-mana", level: "warn", text: ko ? `마나 ${h.manaPct}%. 스킬을 거의 못 써요` : `Mana ${h.manaPct}%. Almost out of spells` });
  }

  if (!h.alive) {
    const canBuyback = h.buybackCooldown <= 0 && p.gold >= h.buybackCost && h.buybackCost > 0;
    out.push({
      id: "dead",
      level: "info",
      text: ko
        ? `${h.respawnSeconds}초 후 부활${canBuyback ? `. 바이백 가능 (${h.buybackCost} 골드)` : ""}`
        : `Respawn in ${h.respawnSeconds}s${canBuyback ? `. Buyback available (${h.buybackCost} gold)` : ""}`,
    });
  }

  if (unspent > 0) {
    out.push({ id: "unspent", level: "warn", text: ko ? `안 찍은 스킬 포인트 ${unspent}개` : `${unspent} unspent ability point${unspent > 1 ? "s" : ""}` });
  }

  const affordable = items.filter((i) => i.affordable && i.key !== "tpscroll");
  if (p.gold >= prefs.goldAlert && affordable.length > 0 && s.clockTime > 0) {
    out.push({
      id: "gold",
      level: "info",
      text: ko ? `${p.gold} 골드. ${affordable[0].name} 구매 가능` : `${p.gold} gold. You can buy ${affordable[0].name} now`,
    });
  }

  // Late game: buying the next item would leave no buyback gold
  if (s.clockTime >= 30 * 60 && h.buybackCost > 0 && h.buybackCooldown <= 0) {
    const next = affordable[0];
    if (next && p.gold - next.remaining < h.buybackCost) {
      out.push({
        id: "buyback-reserve",
        level: "warn",
        text: ko ? `${next.name}을(를) 사면 바이백 골드(${h.buybackCost})가 모자라요` : `Buying ${next.name} leaves you short of buyback (${h.buybackCost})`,
      });
    }
  }

  if (!s.items.teleport && s.clockTime > 0) {
    out.push({ id: "no-tp", level: "warn", text: ko ? "TP 스크롤 없음" : "No TP scroll" });
  }

  if (h.disabled.length) {
    out.push({ id: "disabled", level: "danger", text: ko ? `행동 불가: ${h.disabled.join(", ")}` : `Disabled: ${h.disabled.join(", ")}` });
  }

  return out;
}
