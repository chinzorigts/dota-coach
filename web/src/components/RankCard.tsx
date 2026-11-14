import { post } from "../useCoach";
import type { RankView } from "../types";

const SOURCE_NOTE: Record<RankView["source"], string> = {
  mmr: "MMR you entered in Settings.",
  estimate: "Collected automatically: OpenDota's estimate from your recent ranked matches.",
  medal: "Collected automatically: middle of your medal's range (OpenDota has no finer estimate yet).",
  none: "",
};

const gap = (t: NonNullable<RankView["nextStar"]>, approx: boolean) =>
  `${approx ? "≈" : ""}${t.remaining} MMR · ~${t.wins} win${t.wins === 1 ? "" : "s"}`;

/** Dashboard card: medal, MMR, progress through the current star and what's left to the next star / medal */
export function RankCard({ rank }: { rank: RankView }) {
  if (rank.source === "none") {
    return (
      <div className="panel rank">
        <h2>Rank</h2>
        <p className="muted">
          Collected automatically once Dota sends your account (join any game). Needs "Expose Public Match Data" on in
          Dota's settings so OpenDota can see your matches.
        </p>
      </div>
    );
  }
  const approx = rank.approximate;
  return (
    <div className="panel rank">
      <div className="rank-head">
        <h2>{rank.label}</h2>
        {rank.mmr !== null && <span className="rank-mmr">{approx ? "≈" : ""}{rank.mmr.toLocaleString("en-US")} MMR</span>}
      </div>
      {rank.progress !== null && (
        <div className="rank-bar" role="meter" aria-valuenow={Math.round(rank.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to the next star">
          <span style={{ width: `${Math.round(rank.progress * 100)}%` }} />
        </div>
      )}
      <dl className="rank-next">
        {rank.nextStar && (
          <div><dt>Next: {rank.nextStar.label}</dt><dd>{gap(rank.nextStar, approx)}</dd></div>
        )}
        {rank.nextMedal && (
          <div><dt>Next medal: {rank.nextMedal.label}</dt><dd>{gap(rank.nextMedal, approx)}</dd></div>
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
        {SOURCE_NOTE[rank.source]} Medal bands are community estimates; ±{rank.perGame} per game.
        {rank.openDotaLabel && rank.openDotaLabel !== rank.label && ` OpenDota medal: ${rank.openDotaLabel}.`}
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
