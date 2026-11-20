import type { Report } from "../types";
import { Img } from "./Img";
import { abilityImg, gold as fmt } from "../format";
import { useT } from "../i18n";

/** The biggest element on screen: the two things to do right now */
export function NextStrip({ report, gold, names }: { report: Report; gold: number; names: { abilities: Record<string, string> } }) {
  const t = useT();
  const item = report.items[0];
  const skill = report.skills.next;
  const pct = item ? (item.remaining === 0 ? 100 : Math.min(100, (gold / item.remaining) * 100)) : 0;
  const top = report.alerts.find((a) => a.level === "danger");

  return (
    <section className="next" aria-label={t.nextUp}>
      {item && (
        <div className={`next-card ${item.affordable ? "ready" : ""}`}>
          <Img src={item.img} label={item.name} width={88} height={64} />
          <div className="next-body">
            <span className="next-kind">{item.affordable ? t.readyToBuy : t.nextItem}</span>
            <strong>{item.name}</strong>
            <div className="goldbar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={t.goldToward}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <small>
              {item.affordable ? t.goShop(fmt(item.remaining)) : t.moreGold(fmt(Math.max(0, item.remaining - gold)))}
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
          <span className="next-kind">{skill ? t.abilityPoints(report.skills.unspent) : t.skills}</span>
          <strong>{skill ? (names.abilities[skill.key] ?? skill.name) : t.allSpent}</strong>
          <small>{skill ? (skill.options?.length ? skill.options.map((o) => o.name).join("  /  ") : skill.reason) : t.nextOnLevel}</small>
        </div>
      </div>
      {top && <div className="next-alert" role="alert">{top.text}</div>}
    </section>
  );
}
