import type { Alert, TimerInfo } from "../types";
import { clock } from "../format";
import { useT } from "../i18n";

export function Timers({ timers, alerts }: { timers: TimerInfo[]; alerts: Alert[] }) {
  const T = useT();
  const rest = alerts.filter((a) => a.level !== "danger");
  return (
    <div className="panel">
      {rest.length > 0 && (
        <ul className="alerts">
          {rest.map((a) => <li key={a.id} className={a.level}>{a.text}</li>)}
        </ul>
      )}
      <h3>{T.timers}</h3>
      <ul className="timers">
        {timers.map((t) => (
          <li key={t.id} className={t.inSeconds <= 15 ? "soon" : ""}>
            <span>{t.label}{t.approx && <em title={T.timerApprox}> ≈</em>}</span>
            <time>{clock(t.inSeconds)}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}
