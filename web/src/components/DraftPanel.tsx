import { useEffect, useMemo, useState } from "react";
import type { DraftView, HeroListItem, Position } from "../types";
import { Img } from "./Img";
import { post } from "../useCoach";
import { useT } from "../i18n";

export const POSITION_LABELS: Record<Position, string> = {
  0: "Any",
  1: "1 Carry",
  2: "2 Mid",
  3: "3 Offlane",
  4: "4 Soft sup",
  5: "5 Hard sup",
};

export function setPosition(position: Position) {
  return fetch("/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draft: { position } }),
  }).catch(() => undefined);
}

function PositionPicker({ value }: { value: Position }) {
  const t = useT();
  return (
    <div className="draft-pos" role="radiogroup" aria-label={t.myPosition}>
      {([1, 2, 3, 4, 5, 0] as Position[]).map((p) => (
        <button key={p} type="button" role="radio" aria-checked={value === p} className={value === p ? "on" : ""} onClick={() => setPosition(p)}>
          {t.positions[p]}
        </button>
      ))}
    </div>
  );
}

/** Enemy picks typed in during the draft (GSI usually doesn't send them while playing) */
function EnemyInput({ enemies }: { enemies: string[] }) {
  const T = useT();
  const [heroes, setHeroes] = useState<HeroListItem[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    fetch("/api/heroes").then((r) => r.json()).then(setHeroes).catch(() => setHeroes([]));
  }, []);
  const byName = useMemo(() => new Map(heroes.map((h) => [h.name, h])), [heroes]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? heroes.filter((h) => !enemies.includes(h.name) && h.localizedName.toLowerCase().includes(t)).slice(0, 6) : [];
  }, [q, heroes, enemies]);
  const save = (next: string[]) => post("/api/enemies", { heroes: next }).catch(() => undefined);
  const add = (name: string) => {
    if (enemies.length < 5) save([...enemies, name]);
    setQ("");
  };
  return (
    <div className="draft-enemies">
      <ul className="chips">
        {enemies.map((e) => (
          <li key={e}>
            {byName.get(e) && <Img src={byName.get(e)!.icon} label={byName.get(e)!.localizedName} width={20} height={20} />}
            {byName.get(e)?.localizedName ?? e}
            <button type="button" aria-label={T.remove(byName.get(e)?.localizedName ?? e)} onClick={() => save(enemies.filter((x) => x !== e))}>×</button>
          </li>
        ))}
      </ul>
      {enemies.length < 5 && (
        <div className="picker">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={T.addEnemyPick} aria-label={T.searchEnemies}
            onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) add(matches[0].name); }} />
          {matches.length > 0 && (
            <ul className="suggest" role="listbox">
              {matches.map((h) => (
                <li key={h.name} role="option" aria-selected={false} onMouseDown={() => add(h.name)}>
                  <Img src={h.icon} label={h.localizedName} width={20} height={20} />
                  {h.localizedName}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Suggestion({ s, compact }: { s: DraftView["suggestions"][number]; compact?: boolean }) {
  const t = useT();
  const top = s.reasons[0];
  return (
    <li className="draft-sug">
      <Img src={s.icon} label={s.name} width={compact ? 22 : 28} height={compact ? 22 : 28} />
      <div>
        <strong>{s.name}</strong>
        {!compact && s.winRate !== null && <small> {t.winPct(s.winRate)}</small>}
        {top ? (
          <small className={top.advantage >= 0 ? "pos" : "neg"}>
            {compact ? " " : <br />}
            {t.vs(`${top.advantage >= 0 ? "+" : ""}${top.advantage}`, top.enemy)}
            {!compact && s.reasons.length > 1 && `, ${s.reasons.slice(1).map((r) => t.vs(`${r.advantage >= 0 ? "+" : ""}${r.advantage}`, r.enemy)).join(", ")}`}
          </small>
        ) : null}
      </div>
    </li>
  );
}

/** Dashboard, before your hero is locked in */
export function DraftPanel({ draft }: { draft: DraftView }) {
  const t = useT();
  return (
    <div className="panel draft">
      <h2>{t.pickSuggestions}</h2>
      <PositionPicker value={draft.position} />
      <EnemyInput enemies={draft.enemies} />
      {draft.status === "no-data" ? (
        <p className="muted">{t.draftNoData}</p>
      ) : draft.suggestions.length === 0 ? (
        <p className="muted">{draft.status === "loading" ? t.draftLoading : t.draftNone}</p>
      ) : (
        <ol className="draft-list">
          {draft.suggestions.map((s) => <Suggestion key={s.hero} s={s} />)}
        </ol>
      )}
      <p className="cmp-note">
        {draft.enemies.length
          ? t.draftByAdvantage
          : t.draftByWinRate}
        {draft.bracket ? t.draftBracket : "."}{t.draftFit}
      </p>
    </div>
  );
}

/** Overlay: top three, one line each */
export function DraftCompact({ draft }: { draft: DraftView }) {
  if (!draft.suggestions.length) return null;
  return (
    <div className="ov-draft">
      <small>{POSITION_LABELS[draft.position]} picks{draft.enemies.length ? ` vs ${draft.enemies.length} enemies` : ""}</small>
      <ol className="draft-list">
        {draft.suggestions.slice(0, 3).map((s) => <Suggestion key={s.hero} s={s} compact />)}
      </ol>
    </div>
  );
}
