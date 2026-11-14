import type { RecentGames as RecentGamesT } from "../types";
import { Img } from "./Img";
import { heroIcon } from "../format";

function ago(unixSec: number): string {
  const s = Math.max(0, Date.now() / 1000 - unixSec);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const mins = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** Dashboard: your last 5 matches, newest first */
export function RecentGames({ data }: { data: RecentGamesT }) {
  return (
    <div className="panel recent">
      <div className="rank-head">
        <h2>Last 5 games</h2>
        {data.status === "ok" && data.matches.length > 0 && (
          <span className="recent-wl"><b className="w">{data.wins}W</b> <b className="l">{data.losses}L</b></span>
        )}
      </div>
      {data.status === "loading" ? (
        <p className="muted">Loading from OpenDota… (this endpoint can take ~15s)</p>
      ) : data.status === "unavailable" ? (
        <p className="muted">OpenDota didn't answer, or the profile is private ("Expose Public Match Data" in Dota's settings).</p>
      ) : data.matches.length === 0 ? (
        <p className="muted">No public matches yet.</p>
      ) : (
        <ol className="recent-list">
          {data.matches.map((m) => (
            <li key={m.matchId} className={m.won ? "won" : "lost"}>
              <span className="recent-res" aria-label={m.won ? "Win" : "Loss"}>{m.won ? "W" : "L"}</span>
              {m.hero ? <Img src={heroIcon(m.hero)} label={m.heroName} width={24} height={24} /> : <span className="recent-noicon" />}
              <div className="recent-main">
                <strong>{m.heroName}</strong>
                <small>{ago(m.startTime)} · {mins(m.durationSec)}{m.ranked ? " · ranked" : ""}</small>
              </div>
              <div className="recent-stats">
                <b>{m.kills}/{m.deaths}/{m.assists}</b>
                <small>{m.gpm} GPM · {m.lastHits} LH</small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Overlay (before a game): one line of W/L marks with hero icons */
export function RecentGamesLine({ data }: { data: RecentGamesT }) {
  if (data.status !== "ok" || data.matches.length === 0) return null;
  return (
    <section className="ov-sec" aria-label="Your last 5 games">
      <span className="ov-label">Last 5</span>
      <div className="ov-sec-body ov-recent">
        {data.matches.map((m) => (
          <span key={m.matchId} className={`ov-recent-g ${m.won ? "won" : "lost"}`} title={`${m.heroName} ${m.won ? "win" : "loss"} ${m.kills}/${m.deaths}/${m.assists}`}>
            {m.hero && <Img src={heroIcon(m.hero)} label={m.heroName} width={18} height={18} />}
            <b>{m.won ? "W" : "L"}</b>
          </span>
        ))}
        <small className="ov-recent-sum">{data.wins}-{data.losses}</small>
      </div>
    </section>
  );
}
