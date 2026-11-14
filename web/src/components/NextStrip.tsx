import type { Report } from "../types";
import { Img } from "./Img";
import { abilityImg, gold as fmt } from "../format";

/** 화면에서 가장 큰 요소: 지금 당장 할 일 두 가지 */
export function NextStrip({ report, gold, names }: { report: Report; gold: number; names: { abilities: Record<string, string> } }) {
  const item = report.items[0];
  const skill = report.skills.next;
  const pct = item ? (item.remaining === 0 ? 100 : Math.min(100, (gold / item.remaining) * 100)) : 0;
  const top = report.alerts.find((a) => a.level === "danger");

  return (
    <section className="next" aria-label="다음에 할 일">
      {item && (
        <div className={`next-card ${item.affordable ? "ready" : ""}`}>
          <Img src={item.img} label={item.name} width={88} height={64} />
          <div className="next-body">
            <span className="next-kind">{item.affordable ? "지금 구매 가능" : "다음 아이템"}</span>
            <strong>{item.name}</strong>
            <div className="goldbar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="구매까지 골드">
              <span style={{ width: `${pct}%` }} />
            </div>
            <small>
              {item.affordable ? `${fmt(item.remaining)} 골드 — 상점으로` : `${fmt(Math.max(0, item.remaining - gold))} 골드 더 필요`}
            </small>
          </div>
        </div>
      )}
      <div className={`next-card skill ${skill ? "ready" : "quiet"}`}>
        {skill?.kind === "ability" ? (
          <Img src={abilityImg(skill.key)} label={names.abilities[skill.key] ?? skill.name} width={64} height={64} className="ability-icon" />
        ) : (
          <div className="talent-icon" aria-hidden>{skill ? "★" : "✓"}</div>
        )}
        <div className="next-body">
          <span className="next-kind">{skill ? `스킬 포인트 ${report.skills.unspent}` : "스킬"}</span>
          <strong>{skill ? (names.abilities[skill.key] ?? skill.name) : "다 찍었습니다"}</strong>
          <small>{skill ? (skill.options?.length ? skill.options.map((o) => o.name).join("  /  ") : skill.reason) : "다음 레벨업 때 알려 드립니다"}</small>
        </div>
      </div>
      {top && <div className="next-alert" role="alert">{top.text}</div>}
    </section>
  );
}
