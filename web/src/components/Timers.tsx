import type { Alert, TimerInfo } from "../types";
import { clock } from "../format";

export function Timers({ timers, alerts }: { timers: TimerInfo[]; alerts: Alert[] }) {
  const rest = alerts.filter((a) => a.level !== "danger");
  return (
    <div className="panel">
      {rest.length > 0 && (
        <ul className="alerts">
          {rest.map((a) => <li key={a.id} className={a.level}>{a.text}</li>)}
        </ul>
      )}
      <h3>타이머</h3>
      <ul className="timers">
        {timers.map((t) => (
          <li key={t.id} className={t.inSeconds <= 15 ? "soon" : ""}>
            <span>{t.label}{t.approx && <em title="패치마다 다를 수 있습니다"> ≈</em>}</span>
            <time>{clock(t.inSeconds)}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}
