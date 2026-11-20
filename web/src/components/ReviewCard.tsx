import { useState } from "react";
import type { Review } from "../types";

type Lang = "ko" | "en";
const L = {
  ko: {
    title: "지난 경기 리뷰", win: "승리", loss: "패배", good: "잘한 점", improve: "다음 경기에 고칠 점", pending: "경기를 분석하는 중…", failed: "리뷰를 만들지 못했어요.", min: "분",
    history: "최근 리뷰", trend: "추세", recent: "최근", before: "이전", wins: "승", deaths: "데스", behind: "평균 이하 지표", back: "최신 리뷰로",
    trendNote: (n: number) => `최근 ${n}경기와 그 전 ${n}경기 비교`,
  },
  en: {
    title: "Last game review", win: "Win", loss: "Loss", good: "Went well", improve: "Work on next game", pending: "Reviewing the match…", failed: "The review could not be made.", min: "min",
    history: "Recent reviews", trend: "Trend", recent: "Recent", before: "Before", wins: "W", deaths: "Deaths", behind: "Stats behind average", back: "Back to latest",
    trendNote: (n: number) => `Last ${n} games vs the ${n} before`,
  },
};

function Head({ review, t }: { review: Review; t: (typeof L)["ko"] }) {
  return (
    <span className={`review-res ${review.won ? "won" : "lost"}`}>
      {review.won ? t.win : t.loss} · {review.hero} · {review.kda} · {Math.round(review.durationSec / 60)}{t.min}
    </span>
  );
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Averages of the last few reviewed games against the few before them. Only games that saved their numbers
 * count; needs at least two in the recent group to say anything.
 */
function Trend({ history, t }: { history: Review[]; t: (typeof L)["ko"] }) {
  const withStats = history.filter((r) => r.stats);
  const n = Math.min(5, Math.floor(withStats.length / 2) || withStats.length);
  if (n < 2) return null;
  const recent = withStats.slice(0, n);
  const before = withStats.slice(n, n * 2);
  const rows: { label: string; get: (r: Review) => number; higherIsBetter: boolean; digits?: number }[] = [
    { label: "GPM", get: (r) => r.stats!.gpm, higherIsBetter: true },
    { label: "XPM", get: (r) => r.stats!.xpm, higherIsBetter: true },
    { label: t.deaths, get: (r) => r.stats!.deaths, higherIsBetter: false, digits: 1 },
    { label: t.behind, get: (r) => r.stats!.behind, higherIsBetter: false, digits: 1 },
  ];
  const fmt = (v: number | null, d = 0) => (v === null ? "–" : v.toFixed(d));
  return (
    <div className="review-trend">
      <h3>{t.trend} <small className="muted">{before.length >= 2 ? t.trendNote(n) : ""}</small></h3>
      <table>
        <thead>
          <tr><th></th><th>{t.recent}</th>{before.length >= 2 && <th>{t.before}</th>}</tr>
        </thead>
        <tbody>
          <tr>
            <td>{t.wins}</td>
            <td>{recent.filter((r) => r.won).length}/{recent.length}</td>
            {before.length >= 2 && <td>{before.filter((r) => r.won).length}/{before.length}</td>}
          </tr>
          {rows.map((row) => {
            const a = avg(recent.map(row.get));
            const b = before.length >= 2 ? avg(before.map(row.get)) : null;
            const better = a !== null && b !== null && a !== b ? (a > b) === row.higherIsBetter : null;
            return (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className={better === null ? "" : better ? "good" : "bad"}>{fmt(a, row.digits)}</td>
                {before.length >= 2 && <td>{fmt(b, row.digits)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Dashboard: the debrief of the last finished match, shown between games, with past ones below */
export function ReviewCard({ review: latest, history = [], status, lang }: { review: Review | null; history?: Review[]; status: "idle" | "pending" | "failed"; lang: Lang }) {
  const t = L[lang] ?? L.ko;
  const [picked, setPicked] = useState<string | null>(null);
  const review = (picked && history.find((r) => r.matchId === picked)) || latest;
  return (
    <div className="panel review">
      <div className="rank-head">
        <h2>{t.title}</h2>
        {review && <Head review={review} t={t} />}
      </div>
      {status === "pending" && <p className="pending">{t.pending}</p>}
      {status === "failed" && !review && <p className="muted">{t.failed}</p>}
      {review && (
        <>
          <p className="review-summary">{review.summary}</p>
          <div className="review-cols">
            {review.good.length > 0 && (
              <div>
                <h3 className="good">{t.good}</h3>
                <ul>{review.good.map((g, i) => <li key={i}>{g}</li>)}</ul>
              </div>
            )}
            {review.improve.length > 0 && (
              <div>
                <h3 className="improve">{t.improve}</h3>
                <ul>{review.improve.map((g, i) => <li key={i}>{g}</li>)}</ul>
              </div>
            )}
          </div>
          {review !== latest && (
            <button type="button" className="linkish" onClick={() => setPicked(null)}>{t.back}</button>
          )}
        </>
      )}
      {history.length > 1 && (
        <div className="review-history">
          <Trend history={history} t={t} />
          <div>
            <h3>{t.history}</h3>
            <ul>
              {history.map((r) => (
                <li key={r.matchId}>
                  <button
                    type="button"
                    className={`review-row ${r.matchId === review?.matchId ? "on" : ""}`}
                    onClick={() => setPicked(r.matchId === latest?.matchId ? null : r.matchId)}
                    title={r.improve[0] ?? r.summary}
                  >
                    <span className={r.won ? "won" : "lost"}>{r.won ? t.win : t.loss}</span>
                    <span>{r.hero}</span>
                    <span>{r.kda}</span>
                    <span className="muted">{new Date(r.at).toLocaleDateString(lang === "ko" ? "ko-KR" : undefined, { month: "numeric", day: "numeric" })}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/** Overlay (between games): result line, summary, and the top thing to fix */
export function ReviewCompact({ review, status, label, lang }: { review: Review | null; status: "idle" | "pending" | "failed"; label: string; lang: Lang }) {
  const t = L[lang] ?? L.ko;
  return (
    <section className="ov-sec">
      <span className="ov-label">{label}</span>
      <div className="ov-sec-body ov-review">
        {status === "pending" ? (
          <small className="ov-pending">{t.pending}</small>
        ) : review ? (
          <>
            <Head review={review} t={t} />
            <p>{review.summary}</p>
            {review.improve[0] && <p className="ov-review-fix">→ {review.improve[0]}</p>}
          </>
        ) : null}
      </div>
    </section>
  );
}
