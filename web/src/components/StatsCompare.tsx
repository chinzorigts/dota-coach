import type { BenchmarkView, StatRow } from "../types";

// Big counts read better whole (117 last hits, not 117.1); small ones keep a decimal (2.4 kills)
const fmt = (v: number | null, key: StatRow["key"]) =>
  v === null ? "–" : key === "gpm" || key === "xpm" || Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);

const VERDICT_LABEL = { good: "Ahead", ok: "On pace", bad: "Behind" } as const;

function Verdict({ v }: { v: StatRow["verdict"] }) {
  if (!v) return <span className="cmp-v none" aria-hidden>·</span>;
  return <span className={`cmp-v ${v}`}>{VERDICT_LABEL[v]}</span>;
}

/** Percentile among everyone who played the hero, as a thin bar with a median tick */
function PctBar({ pct, better }: { pct: number; better: "higher" | "lower" }) {
  const shown = better === "higher" ? pct : 100 - pct;
  return (
    <span className="cmp-pct" role="meter" aria-valuenow={shown} aria-valuemin={0} aria-valuemax={100} aria-label={`Top ${100 - shown}% of players on this hero`}>
      <span style={{ width: `${shown}%` }} />
      <i aria-hidden />
    </span>
  );
}

function sourceNote(b: BenchmarkView): string {
  const parts: string[] = [];
  if (b.hero === "ok") parts.push("Hero: median of all public matches of this hero (OpenDota)");
  else if (b.hero === "loading") parts.push("Loading hero averages…");
  else parts.push("Hero averages unavailable (offline?)");
  if (b.personal === "ok") parts.push(`Mine: your ${b.personalGames} games on this hero`);
  else if (b.personal === "loading") parts.push("Loading your history…");
  else parts.push("Your avg needs a public profile with 3+ games on this hero");
  return parts.join(" · ");
}

/** Dashboard: your live numbers next to the hero average and your own average at this minute */
export function StatsCompare({ b }: { b: BenchmarkView }) {
  // The hero column is narrow: drop columns that would only show dashes
  const hasHero = b.rows.some((r) => r.heroMedian !== null);
  const hasMine = b.rows.some((r) => r.personal !== null);
  const hasPct = b.rows.some((r) => r.heroPercentile !== null);
  return (
    <div className="panel cmp">
      <div className="cmp-head">
        <h2>You vs average</h2>
        <span>
          at {b.minute}:00{b.killParticipation !== null && <> · KP <b>{b.killParticipation}%</b></>}
        </span>
      </div>
      {b.rows.length === 0 ? (
        <p className="muted">{b.minute < 2 ? "Comparisons start at 2:00." : sourceNote(b)}</p>
      ) : (
        <>
          {b.early && <p className="cmp-early">Early game: GPM/XPM climb over the match, so verdicts wait until 10:00.</p>}
          <table className="cmp-table">
            <thead>
              <tr>
                <th scope="col">Stat</th><th scope="col">You</th>
                {hasHero && <th scope="col">Hero</th>}
                {hasMine && <th scope="col">Mine</th>}
                {hasPct && <th scope="col"><span className="sr-only">Percentile</span></th>}
                <th scope="col"><span className="sr-only">Verdict</span></th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  <td className="num">{fmt(r.value, r.key)}</td>
                  {hasHero && <td className="num muted">{fmt(r.heroMedian, r.key)}</td>}
                  {hasMine && <td className="num muted">{fmt(r.personal, r.key)}</td>}
                  {hasPct && <td>{r.heroPercentile !== null ? <PctBar pct={r.heroPercentile} better={r.better} /> : null}</td>}
                  <td><Verdict v={r.verdict} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cmp-note">{sourceNote(b)}. Counts are what the average player has by this minute.</p>
        </>
      )}
    </div>
  );
}

/** Overlay: one short line per stat that has a verdict, worst first, so a glance shows what to fix */
export function StatsCompareCompact({ b }: { b: BenchmarkView }) {
  const order = { bad: 0, ok: 1, good: 2 } as const;
  const rows = b.rows.filter((r) => r.verdict).sort((x, y) => order[x.verdict!] - order[y.verdict!]).slice(0, 4);
  if (!rows.length) return null;
  const SHORT: Record<string, string> = { kills: "K", deaths: "D", assists: "A", lastHits: "LH", denies: "DN", gpm: "GPM", xpm: "XPM" };
  return (
    <section className="ov-sec" aria-label="You versus the average player at this minute">
      <span className="ov-label">Pace</span>
      <div className="ov-sec-body ov-cmp">
        {rows.map((r) => {
          const ref = r.personal ?? r.heroMedian;
          return (
            <span key={r.key} className={`ov-cmp-chip ${r.verdict!}`} title={`${r.label}: you ${fmt(r.value, r.key)}, average ${ref === null ? "–" : fmt(ref, r.key)}`}>
              <i aria-hidden />
              {SHORT[r.key] ?? r.label} <b>{fmt(r.value, r.key)}</b>
              {ref !== null && <small>/{fmt(ref, r.key)}</small>}
            </span>
          );
        })}
      </div>
    </section>
  );
}
