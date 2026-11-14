import type { Report, Snapshot } from "../types";
import { clock } from "../format";

const PHASE: Record<Report["phase"], string> = { pre: "Pre-game", early: "Early game", mid: "Mid game", late: "Late game" };

export function TopBar({ connected, gsiAge, snapshot, report }: {
  connected: boolean;
  gsiAge: number;
  snapshot: Snapshot | null;
  report: Report | null;
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
    </header>
  );
}
