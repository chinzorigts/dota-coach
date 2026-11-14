import type { GameSnapshot } from "../gsi/normalize.js";
import type { Alert, ItemRec } from "./types.js";

export function buildAlerts(s: GameSnapshot, unspent: number, items: ItemRec[]): Alert[] {
  const out: Alert[] = [];
  const h = s.hero;
  const p = s.player;
  if (!h || !p) return out;

  if (h.alive && h.healthPct > 0 && h.healthPct <= 25) {
    out.push({ id: "low-hp", level: "danger", text: `체력 ${h.healthPct}% — 후퇴하거나 회복하세요` });
  } else if (h.alive && h.healthPct <= 45) {
    out.push({ id: "mid-hp", level: "warn", text: `체력 ${h.healthPct}% — 무리한 교전 주의` });
  }

  if (h.alive && h.maxMana > 0 && h.manaPct <= 15) {
    out.push({ id: "low-mana", level: "warn", text: `마나 ${h.manaPct}% — 스킬 사용 불가 상태에 가깝습니다` });
  }

  if (!h.alive) {
    const canBuyback = h.buybackCooldown <= 0 && p.gold >= h.buybackCost && h.buybackCost > 0;
    out.push({
      id: "dead",
      level: "info",
      text: `부활까지 ${h.respawnSeconds}초${canBuyback ? ` · 바이백 가능 (${h.buybackCost}골드)` : ""}`,
    });
  }

  if (unspent > 0) {
    out.push({ id: "unspent", level: "warn", text: `스킬 포인트 ${unspent}개 남음` });
  }

  const affordable = items.filter((i) => i.affordable && i.key !== "tpscroll");
  if (p.gold >= 2000 && affordable.length > 0 && s.clockTime > 0) {
    out.push({
      id: "gold",
      level: "info",
      text: `골드 ${p.gold} — 지금 ${affordable[0].name} 살 수 있습니다`,
    });
  }

  // 후반: 아이템 사고 나면 바이백 골드가 안 남는 경우
  if (s.clockTime >= 30 * 60 && h.buybackCost > 0 && h.buybackCooldown <= 0) {
    const next = affordable[0];
    if (next && p.gold - next.remaining < h.buybackCost) {
      out.push({
        id: "buyback-reserve",
        level: "warn",
        text: `${next.name} 사면 바이백 골드(${h.buybackCost})가 부족해집니다`,
      });
    }
  }

  if (!s.items.teleport && s.clockTime > 0) {
    out.push({ id: "no-tp", level: "warn", text: "TP 스크롤 없음" });
  }

  if (h.disabled.length) {
    out.push({ id: "disabled", level: "danger", text: `상태이상: ${h.disabled.join(", ")}` });
  }

  return out;
}
