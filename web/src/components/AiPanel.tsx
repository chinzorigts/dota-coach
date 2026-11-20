import { useState } from "react";
import type { CoachState } from "../types";
import { clock, itemImg } from "../format";
import { Img } from "./Img";
import { post } from "../useCoach";
import { useT } from "../i18n";

const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

/** Calls, tokens and approximate cost this match and since the server started */
function UsageLine({ usage }: { usage: CoachState["aiUsage"] }) {
  const t = useT();
  if (!usage || usage.session.calls === 0) return null;
  const { match: m, session: s } = usage;
  const approx = usage.priced ? "~" : "≥";
  return (
    <small className="meta usage" title={t.usageTitle}>
      {t.usage(m.calls, tokens(m.inputTokens + m.outputTokens), `${approx}${usd(m.usd)}`, s.calls, `${approx}${usd(s.usd)}`)}
    </small>
  );
}

export function AiPanel({ ai, names, clockNow, usage }: { ai: CoachState["ai"]; names: CoachState["names"]; clockNow?: number; usage?: CoachState["aiUsage"] }) {
  const t = useT();
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
        <h3>{t.aiCoach}</h3>
        <p>{t.aiOffBefore}<code>ANTHROPIC_API_KEY</code>{t.aiOffMid}<code>.env</code>{t.aiOffAfter}</p>
      </div>
    );
  }

  const a = ai.advice;
  return (
    <div className="panel ai" aria-live="polite">
      <h3>
        {t.aiCoach}
        {a && <span className={`danger ${a.danger}`}>{t.danger[a.danger]}</span>}
      </h3>
      {ai.pending && <p className="pending">{t.analyzing(t.aiReason[ai.pending] ?? ai.pending)}</p>}
      {ai.error && <p className="error">{ai.error}</p>}
      {a ? (
        <>
          {a.question && <p className="question">“{a.question}”</p>}
          <p className="summary">{a.summary}</p>
          {a.tips.length > 0 && (
            <ul className="tips">
              {a.tips.map((tip, i) => <li key={i}>{tip}</li>)}
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
          <small className={`meta ${clockNow !== undefined && clockNow - a.clock > 90 ? "stale" : ""}`}>
            {t.atClock(t.aiReason[a.reason] ?? a.reason, clock(a.clock))}
            {clockNow !== undefined && clockNow - a.clock >= 20 ? t.ago(clock(clockNow - a.clock)) : ""}
            {ai.lastMs ? t.answeredIn((ai.lastMs / 1000).toFixed(1)) : ""}
          </small>
        </>
      ) : (
        !ai.pending && <p className="muted">{t.firstRead}</p>
      )}
      <form onSubmit={ask} className="ask">
        <label htmlFor="ask-q" className="sr-only">{t.askLabel}</label>
        <input
          id="ask-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.askPlaceholder}
          maxLength={500}
        />
        <button type="submit" disabled={Boolean(ai.pending)}>{t.ask}</button>
      </form>
      <UsageLine usage={usage} />
      {err && <p className="error">{err}</p>}
    </div>
  );
}
