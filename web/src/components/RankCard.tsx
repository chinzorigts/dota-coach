import { post } from "../useCoach";
import type { RankView } from "../types";
import { useT, type Strings } from "../i18n";

const gap = (t: NonNullable<RankView["nextStar"]>, approx: boolean, T: Strings) =>
  `${approx ? "≈" : ""}${t.remaining} MMR · ${T.winsNeeded(t.wins)}`;

/** Dashboard card: medal, MMR, progress through the current star and what's left to the next star / medal */
export function RankCard({ rank }: { rank: RankView }) {
  const T = useT();
  if (rank.source === "none") {
    return (
      <div className="panel rank">
        <h2>{T.rank}</h2>
        <p className="muted">{T.rankNone}</p>
      </div>
    );
  }
  const approx = rank.approximate;
  return (
    <div className="panel rank">
      <div className="rank-head">
        <h2>{rank.label}</h2>
        {rank.mmr !== null && <span className="rank-mmr">{approx ? "≈" : ""}{rank.mmr.toLocaleString(T.locale)} MMR</span>}
      </div>
      {rank.progress !== null && (
        <div className="rank-bar" role="meter" aria-valuenow={Math.round(rank.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={T.progressNextStar}>
          <span style={{ width: `${Math.round(rank.progress * 100)}%` }} />
        </div>
      )}
      <dl className="rank-next">
        {rank.nextStar && (
          <div><dt>{T.nextStar(rank.nextStar.label)}</dt><dd>{gap(rank.nextStar, approx, T)}</dd></div>
        )}
        {rank.nextMedal && (
          <div><dt>{T.nextMedal(rank.nextMedal.label)}</dt><dd>{gap(rank.nextMedal, approx, T)}</dd></div>
        )}
        {!rank.nextStar && <div><dt>{T.topTier}</dt><dd>{T.immortalLeaderboard}</dd></div>}
      </dl>
      {rank.lastChange && (
        <p className="rank-last">
          {T.lastGame}{rank.lastChange.delta > 0 ? "+" : ""}{rank.lastChange.delta}
          <button type="button" className="link" onClick={() => post("/api/rank/undo", {})}>{T.undoUnranked}</button>
        </p>
      )}
      <p className="cmp-note">
        {T.rankSource[rank.source]}{T.medalBands(rank.perGame)}
        {rank.openDotaLabel && rank.openDotaLabel !== rank.label && T.openDotaMedal(rank.openDotaLabel)}
      </p>
    </div>
  );
}

/** Overlay: one line */
export function RankLine({ rank }: { rank: RankView }) {
  if (rank.source === "none" || !rank.label) return null;
  const t = rank.nextStar;
  const a = rank.approximate ? "≈" : "";
  return (
    <p className="ov-rank">
      <b>{rank.label}</b>
      {rank.mmr !== null && <> {a}{rank.mmr}</>}
      {t && <small> → {t.label} in {a}{t.remaining} (~{t.wins}W)</small>}
    </p>
  );
}
