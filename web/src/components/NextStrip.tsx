import type { Report } from "../types";
import { Img } from "./Img";
import { abilityImg, gold as fmt } from "../format";

/** The biggest element on screen: the two things to do right now */
export function NextStrip({ report, gold, names }: { report: Report; gold: number; names: { abilities: Record<string, string> } }) {
  const item = report.items[0];
  const skill = report.skills.next;
  const pct = item ? (item.remaining === 0 ? 100 : Math.min(100, (gold / item.remaining) * 100)) : 0;
  const top = report.alerts.find((a) => a.level === "danger");

  return (
    <section className="next" aria-label="Next up">
      {item && (
        <div className={`next-card ${item.affordable ? "ready" : ""}`}>
          <Img src={item.img} label={item.name} width={88} height={64} />
          <div className="next-body">
            <span className="next-kind">{item.affordable ? "Ready to buy" : "Next item"}</span>
            <strong>{item.name}</strong>
            <div className="goldbar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Gold toward this item">
              <span style={{ width: `${pct}%` }} />
            </div>
            <small>
              {item.affordable ? `${fmt(item.remaining)} gold. Go shop` : `${fmt(Math.max(0, item.remaining - gold))} more gold needed`}
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
          <span className="next-kind">{skill ? `Ability points: ${report.skills.unspent}` : "Skills"}</span>
          <strong>{skill ? (names.abilities[skill.key] ?? skill.name) : "All points spent"}</strong>
          <small>{skill ? (skill.options?.length ? skill.options.map((o) => o.name).join("  /  ") : skill.reason) : "You'll see the next pick on level up"}</small>
        </div>
      </div>
      {top && <div className="next-alert" role="alert">{top.text}</div>}
    </section>
  );
}
