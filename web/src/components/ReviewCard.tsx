import type { Review } from "../types";

type Lang = "ko" | "en";
const L = {
  ko: { title: "지난 경기 리뷰", win: "승리", loss: "패배", good: "잘한 점", improve: "다음 경기에 고칠 점", pending: "경기를 분석하는 중…", failed: "리뷰를 만들지 못했어요.", min: "분" },
  en: { title: "Last game review", win: "Win", loss: "Loss", good: "Went well", improve: "Work on next game", pending: "Reviewing the match…", failed: "The review could not be made.", min: "min" },
};

function Head({ review, t }: { review: Review; t: (typeof L)["ko"] }) {
  return (
    <span className={`review-res ${review.won ? "won" : "lost"}`}>
      {review.won ? t.win : t.loss} · {review.hero} · {review.kda} · {Math.round(review.durationSec / 60)}{t.min}
    </span>
  );
}

/** Dashboard: the debrief of the last finished match, shown between games */
export function ReviewCard({ review, status, lang }: { review: Review | null; status: "idle" | "pending" | "failed"; lang: Lang }) {
  const t = L[lang] ?? L.ko;
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
        </>
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
