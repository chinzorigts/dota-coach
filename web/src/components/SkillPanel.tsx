import type { Report, Snapshot } from "../types";
import { Img } from "./Img";
import { abilityImg } from "../format";

export function SkillPanel({ snapshot, report, names }: { snapshot: Snapshot; report: Report; names: { abilities: Record<string, string> } }) {
  const next = report.skills.next;
  const order = report.skills.priority;
  // Innate abilities can't be leveled; the priority list holds the levelable basic abilities
  const abilities = snapshot.abilities.filter((a) => a.ultimate || order.includes(a.name));

  return (
    <div className="panel">
      <h3>
        Skills
        <span className="sub">{report.skills.prioritySource === "ai" ? "AI priority" : "Default priority"}</span>
      </h3>
      <ul className="skills">
        {abilities.map((a) => {
          const max = a.ultimate ? 3 : 4;
          const rank = order.indexOf(a.name);
          return (
            <li key={a.name} className={next?.key === a.name ? "next" : ""}>
              <Img src={abilityImg(a.name)} label={names.abilities[a.name] ?? a.name} width={40} height={40} />
              <div>
                <strong>{names.abilities[a.name]}</strong>
                <div className="pips" aria-label={`Level ${a.level} of ${max}`}>
                  {Array.from({ length: max }, (_, i) => <i key={i} className={i < a.level ? "on" : ""} />)}
                </div>
              </div>
              <span className="rank">{a.ultimate ? "Ult" : rank >= 0 ? `#${rank + 1}` : ""}</span>
            </li>
          );
        })}
      </ul>
      {!next && report.skills.upcoming && (
        <p className="skill-upcoming">
          At level {report.skills.upcoming.atLevel}: <strong>{names.abilities[report.skills.upcoming.key] ?? report.skills.upcoming.name}</strong>
          {report.skills.upcoming.options?.length ? ` (${report.skills.upcoming.options.map((o) => o.name).join(" / ")})` : ""}
        </p>
      )}
      {next?.kind === "talent" && (
        <div className="talent">
          <strong>{next.name}</strong>
          <div>{next.options?.map((o) => <span key={o.key}>{o.name}</span>)}</div>
        </div>
      )}
    </div>
  );
}
