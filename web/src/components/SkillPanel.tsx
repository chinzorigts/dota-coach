import type { Report, Snapshot } from "../types";
import { Img } from "./Img";
import { abilityImg } from "../format";

export function SkillPanel({ snapshot, report, names }: { snapshot: Snapshot; report: Report; names: { abilities: Record<string, string> } }) {
  const next = report.skills.next;
  const order = report.skills.priority;
  // 타고난(innate) 스킬은 찍을 수 없으니 뺀다 — 우선순위 목록 = 찍을 수 있는 일반 스킬
  const abilities = snapshot.abilities.filter((a) => a.ultimate || order.includes(a.name));

  return (
    <div className="panel">
      <h3>
        스킬
        <span className="sub">{report.skills.prioritySource === "ai" ? "AI 우선순위" : "기본 우선순위"}</span>
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
                <div className="pips" aria-label={`${a.level} / ${max} 레벨`}>
                  {Array.from({ length: max }, (_, i) => <i key={i} className={i < a.level ? "on" : ""} />)}
                </div>
              </div>
              <span className="rank">{a.ultimate ? "궁" : rank >= 0 ? `${rank + 1}순위` : ""}</span>
            </li>
          );
        })}
      </ul>
      {next?.kind === "talent" && (
        <div className="talent">
          <strong>{next.name}</strong>
          <div>{next.options?.map((o) => <span key={o.key}>{o.name}</span>)}</div>
        </div>
      )}
    </div>
  );
}
