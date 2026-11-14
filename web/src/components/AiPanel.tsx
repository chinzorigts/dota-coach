import { useState } from "react";
import type { CoachState } from "../types";
import { clock, itemImg } from "../format";
import { Img } from "./Img";
import { post } from "../useCoach";

const REASON: Record<string, string> = {
  hero: "게임 시작 분석",
  death: "사망 후 분석",
  minute: "5분 정기 분석",
  enemies: "적 조합 반영",
  manual: "질문에 대한 답",
};
const DANGER: Record<string, string> = { low: "안정", medium: "주의", high: "위험" };

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
        <h3>AI 코치</h3>
        <p>꺼져 있습니다. 저장소 루트의 <code>.env</code> 에 <code>ANTHROPIC_API_KEY</code> 를 넣고 서버를 다시 켜면 상황 분석과 질문 답변이 켜집니다. 지금 보이는 추천은 규칙·통계 엔진입니다.</p>
      </div>
    );
  }

  const a = ai.advice;
  return (
    <div className="panel ai" aria-live="polite">
      <h3>
        AI 코치
        {a && <span className={`danger ${a.danger}`}>{DANGER[a.danger]}</span>}
      </h3>
      {ai.pending && <p className="pending">분석 중… ({REASON[ai.pending]})</p>}
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
          <small className="meta">{REASON[a.reason]} · 게임 시간 {clock(a.clock)}</small>
        </>
      ) : (
        !ai.pending && <p className="muted">영웅이 정해지면 첫 분석을 시작합니다.</p>
      )}
      <form onSubmit={ask} className="ask">
        <label htmlFor="ask-q" className="sr-only">AI 에게 질문</label>
        <input
          id="ask-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="예: 지금 BKB 가요, 블링크 가요?"
          maxLength={500}
        />
        <button type="submit" disabled={Boolean(ai.pending)}>물어보기</button>
      </form>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
