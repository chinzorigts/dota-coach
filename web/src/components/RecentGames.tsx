import type { RecentGames as RecentGamesT } from "../types";
import { Img } from "./Img";
import { heroIcon } from "../format";
import { useT, type Strings } from "../i18n";

function ago(unixSec: number, t: Strings): string {
  const s = Math.max(0, Date.now() / 1000 - unixSec);
  if (s < 3600) return t.minAgo(Math.max(1, Math.round(s / 60)));
  if (s < 86400) return t.hourAgo(Math.round(s / 3600));
  return t.dayAgo(Math.round(s / 86400));
}

const mins = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** Dashboard: your last 5 matches, newest first */
export function RecentGames({ data }: { data: RecentGamesT }) {
  const t = useT();
  return (
    <div className="panel recent">
      <div className="rank-head">
        <h2>{t.last5}</h2>
        {data.status === "ok" && data.matches.length > 0 && (
          <span className="recent-wl"><b className="w">{data.wins}{t.winsShort}</b> <b className="l">{data.losses}{t.lossesShort}</b></span>
        )}
      </div>
      {data.status === "loading" ? (
        <p className="muted">{t.recentLoading}</p>
      ) : data.status === "unavailable" ? (
        <p className="muted">{t.recentUnavailable}</p>
      ) : data.matches.length === 0 ? (
        <p className="muted">{t.recentNone}</p>
      ) : (
        <ol className="recent-list">
          {data.matches.map((m) => (
            <li key={m.matchId} className={m.won ? "won" : "lost"}>
              <span className="recent-res" aria-label={m.won ? t.win : t.loss}>{m.won ? t.winsShort : t.lossesShort}</span>
              {m.hero ? <Img src={heroIcon(m.hero)} label={m.heroName} width={24} height={24} /> : <span className="recent-noicon" />}
              <div className="recent-main">
                <strong>{m.heroName}</strong>
                <small>{ago(m.startTime, t)} · {mins(m.durationSec)}{m.ranked ? ` · ${t.ranked}` : ""}</small>
              </div>
              <div className="recent-stats">
                <b>{m.kills}/{m.deaths}/{m.assists}</b>
                <small>{m.gpm} GPM · {m.lastHits} {t.lhShort}</small>
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
