import { post } from "../useCoach";
import type { RankView } from "../types";

const gap = (t: NonNullable<RankView["nextStar"]>, medalOnly: boolean) =>
  medalOnly ? `up to ${t.remaining} MMR` : `${t.remaining} MMR · ~${t.wins} win${t.wins === 1 ? "" : "s"}`;

/** Dashboard card: medal, MMR, progress through the current star and what's left to the next star / medal */
export function RankCard({ rank }: { rank: RankView }) {
  if (rank.source === "none") {
    return (
      <div className="panel rank">
        <h2>Rank</h2>
        <p className="muted">
          Enter your MMR in <a href="#settings">Settings</a> to see how far the next medal is. Your exact MMR is on your
          Dota profile; the game doesn't send it to apps.
        </p>
      </div>
    );
  }
  const medalOnly = rank.source === "medal";
  return (
    <div className="panel rank">
      <div className="rank-head">
        <h2>{rank.label}</h2>
        {rank.mmr !== null && <span className="rank-mmr">{rank.mmr.toLocaleString("en-US")} MMR</span>}
      </div>
      {rank.progress !== null && (
        <div className="rank-bar" role="meter" aria-valuenow={Math.round(rank.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to the next star">
          <span style={{ width: `${Math.round(rank.progress * 100)}%` }} />
        </div>
      )}
      <dl className="rank-next">
        {rank.nextStar && (
          <div><dt>Next: {rank.nextStar.label}</dt><dd>{gap(rank.nextStar, medalOnly)}</dd></div>
        )}
        {rank.nextMedal && (
          <div><dt>Next medal: {rank.nextMedal.label}</dt><dd>{gap(rank.nextMedal, false)}</dd></div>
        )}
        {!rank.nextStar && <div><dt>Top tier</dt><dd>Immortal is ranked by leaderboard</dd></div>}
      </dl>
      {rank.lastChange && (
        <p className="rank-last">
          Last game {rank.lastChange.delta > 0 ? "+" : ""}{rank.lastChange.delta}
          <button type="button" className="link" onClick={() => post("/api/rank/undo", {})}>Undo (unranked game)</button>
        </p>
      )}
      <p className="cmp-note">
        {medalOnly
          ? "Medal from OpenDota. Enter your MMR in Settings for exact numbers."
          : `Medal bands are community estimates; Valve doesn't publish them. ±${rank.perGame} per game.`}
        {rank.openDotaLabel && rank.source === "mmr" && rank.openDotaLabel !== rank.label && ` OpenDota shows ${rank.openDotaLabel}.`}
      </p>
    </div>
  );
}

/** Overlay: one line */
export function RankLine({ rank }: { rank: RankView }) {
  if (rank.source === "none" || !rank.label) return null;
  const t = rank.nextStar;
  return (
    <p className="ov-rank">
      <b>{rank.label}</b>
      {rank.mmr !== null && <> {rank.mmr}</>}
      {t && <small> → {t.label} {rank.source === "medal" ? "" : `in ${t.remaining} (~${t.wins}W)`}</small>}
    </p>
  );
}
