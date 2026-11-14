import { useState } from "react";
import type { CoachState } from "../types";
import { clock, itemImg } from "../format";
import { Img } from "./Img";
import { post } from "../useCoach";

const REASON: Record<string, string> = {
  hero: "Opening read",
  death: "After death",
  minute: "5-minute check",
  enemies: "Enemy lineup update",
  manual: "Your question",
};
const DANGER: Record<string, string> = { low: "Stable", medium: "Careful", high: "Danger" };

export function AiPanel({ ai, names }: { ai: CoachState["ai"]; names: CoachState["names"] }) {
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await post("/api/ask", { question: q });
      setQ("");
    } catch (x) {
      setErr((x as Error).message);
    }
  };

  if (!ai.enabled) {
    return (
      <div className="panel ai off">
        <h3>AI coach</h3>
        <p>Off. Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> at the repo root and restart the server to turn on situational analysis and questions. The picks you see now come from the rules and stats engine.</p>
      </div>
    );
  }

  const a = ai.advice;
  return (
    <div className="panel ai" aria-live="polite">
      <h3>
        AI coach
        {a && <span className={`danger ${a.danger}`}>{DANGER[a.danger]}</span>}
      </h3>
      {ai.pending && <p className="pending">Analyzing… ({REASON[ai.pending]})</p>}
      {ai.error && <p className="error">{ai.error}</p>}
      {a ? (
        <>
          {a.question && <p className="question">“{a.question}”</p>}
          <p className="summary">{a.summary}</p>
          {a.tips.length > 0 && (
            <ul className="tips">
              {a.tips.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          )}
          {a.next_items.length > 0 && (
            <div className="ai-items">
              {a.next_items.map((it) => (
                <span key={it.item} title={it.reason}>
                  <Img src={itemImg(it.item)} label={names.items[it.item] ?? it.item} width={33} height={24} />
                  {names.items[it.item] ?? it.item}
                </span>
              ))}
            </div>
          )}
          <small className="meta">{REASON[a.reason]}, at {clock(a.clock)}</small>
        </>
      ) : (
        !ai.pending && <p className="muted">The first read starts once your hero is locked in.</p>
      )}
      <form onSubmit={ask} className="ask">
        <label htmlFor="ask-q" className="sr-only">Ask the AI coach</label>
        <input
          id="ask-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. BKB or Blink next?"
          maxLength={500}
        />
        <button type="submit" disabled={Boolean(ai.pending)}>Ask</button>
      </form>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
