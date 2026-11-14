import type { Report, Snapshot } from "../types";
import { clock } from "../format";

const PHASE: Record<Report["phase"], string> = { pre: "Pre-game", early: "Early game", mid: "Mid game", late: "Late game" };

export function TopBar({ connected, gsiAge, snapshot, report, inSettings, noKey }: {
  connected: boolean;
  gsiAge: number;
  snapshot: Snapshot | null;
  report: Report | null;
  inSettings: boolean;
  noKey: boolean;
}) {
  const live = connected && gsiAge < 5;
  const status = !connected ? "Server disconnected" : gsiAge === Infinity ? "Waiting for game data" : gsiAge < 5 ? "Live" : `Last update ${Math.floor(gsiAge)}s ago`;
  const mine = snapshot?.team;
  return (
    <header className="topbar">
      <div className="brand">Dota Coach</div>
      {snapshot && snapshot.hero && (
        <div className="match">
          <span className={`score radiant ${mine === "radiant" ? "mine" : ""}`}>{snapshot.score.radiant}</span>
          <span className="clock" aria-label="Game clock">{clock(snapshot.clockTime)}</span>
          <span className={`score dire ${mine === "dire" ? "mine" : ""}`}>{snapshot.score.dire}</span>
          <span className={`daynight ${snapshot.daytime ? "day" : "night"}`}>{snapshot.daytime ? "Day" : "Night"}</span>
          {report && <span className="phase">{PHASE[report.phase]}</span>}
          {snapshot.paused && <span className="paused">Paused</span>}
        </div>
      )}
      <div className={`status ${live ? "live" : connected ? "idle" : "down"}`} role="status">
        <i aria-hidden />
        {status}
      </div>
      <a className={`gear ${inSettings ? "on" : ""}`} href={inSettings ? "#" : "#settings"}
        aria-label={inSettings ? "Close settings" : "Settings"} title={noKey ? "Settings: add an API key to turn on AI advice" : "Settings"}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path fill="currentColor" d="M19.4 13a7.7 7.7 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.5 11a7.7 7.7 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)" />
        </svg>
        {noKey && <i className="gear-dot" aria-hidden />}
      </a>
    </header>
  );
}
