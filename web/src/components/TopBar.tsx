import type { Report, Snapshot } from "../types";
import { clock } from "../format";

const PHASE: Record<Report["phase"], string> = { pre: "게임 시작 전", early: "초반", mid: "중반", late: "후반" };

export function TopBar({ connected, gsiAge, snapshot, report }: {
  connected: boolean;
  gsiAge: number;
  snapshot: Snapshot | null;
  report: Report | null;
}) {
  const live = connected && gsiAge < 5;
  const status = !connected ? "서버 연결 끊김" : gsiAge === Infinity ? "게임 데이터 대기" : gsiAge < 5 ? "실시간" : `${Math.floor(gsiAge)}초 전 수신`;
  const mine = snapshot?.team;
  return (
    <header className="topbar">
      <div className="brand">Dota Coach</div>
      {snapshot && snapshot.hero && (
        <div className="match">
          <span className={`score radiant ${mine === "radiant" ? "mine" : ""}`}>{snapshot.score.radiant}</span>
          <span className="clock" aria-label="게임 시간">{clock(snapshot.clockTime)}</span>
          <span className={`score dire ${mine === "dire" ? "mine" : ""}`}>{snapshot.score.dire}</span>
          <span className={`daynight ${snapshot.daytime ? "day" : "night"}`}>{snapshot.daytime ? "낮" : "밤"}</span>
          {report && <span className="phase">{PHASE[report.phase]}</span>}
          {snapshot.paused && <span className="paused">일시정지</span>}
        </div>
      )}
      <div className={`status ${live ? "live" : connected ? "idle" : "down"}`} role="status">
        <i aria-hidden />
        {status}
      </div>
    </header>
  );
}
