import type { CoachState } from "../types";
import { Img } from "./Img";
import { gold as fmt, itemImg } from "../format";

function Bar({ kind, value, max, pct }: { kind: "hp" | "mp"; value: number; max: number; pct: number }) {
  return (
    <div className={`bar ${kind}`} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={kind === "hp" ? "체력" : "마나"}>
      <span style={{ width: `${pct}%` }} />
      <em>{value} / {max}</em>
    </div>
  );
}

export function HeroPanel({ state }: { state: CoachState }) {
  const s = state.snapshot!;
  const h = s.hero!;
  const p = s.player;
  const r = state.report!;
  const slots = Array.from({ length: 6 }, (_, i) => s.items.inventory.find((it) => it.slot === `slot${i}`));

  return (
    <div className="panel hero">
      <div className="hero-head">
        {state.heroInfo && <Img src={state.heroInfo.img} label={state.heroInfo.localizedName} className="portrait" />}
        <div>
          <h2>{state.heroInfo?.localizedName ?? h.name}</h2>
          <span className="lvl">레벨 {h.level}</span>
          {!h.alive && <span className="dead">사망 · {h.respawnSeconds}초</span>}
        </div>
      </div>
      <Bar kind="hp" value={h.health} max={h.maxHealth} pct={h.healthPct} />
      <Bar kind="mp" value={h.mana} max={h.maxMana} pct={h.manaPct} />

      <dl className="stats">
        <div><dt>KDA</dt><dd>{r.stats.kda}</dd></div>
        <div><dt>막타 / 디나이</dt><dd>{p?.lastHits ?? 0} / {p?.denies ?? 0}</dd></div>
        <div><dt>분당 막타</dt><dd>{r.stats.lhPerMin}</dd></div>
        <div><dt>GPM</dt><dd>{p?.gpm ?? 0}</dd></div>
        <div><dt>XPM</dt><dd>{p?.xpm ?? 0}</dd></div>
        <div><dt>골드</dt><dd className="gold">{fmt(p?.gold ?? 0)}</dd></div>
        <div className="wide"><dt>순자산(추정)</dt><dd>{fmt(r.stats.netWorth)}</dd></div>
      </dl>

      <div className="inventory" aria-label="인벤토리">
        {slots.map((it, i) =>
          it ? (
            <Img key={i} src={itemImg(it.name)} label={state.names.items[it.name] ?? it.name} />
          ) : (
            <span key={i} className="empty" aria-hidden />
          ),
        )}
      </div>
      <div className="extras">
        <span className={s.items.teleport ? "ok" : "missing"}>TP {s.items.teleport ? "있음" : "없음"}</span>
        {h.aghsScepter && <span className="ok">아가님 셉터</span>}
        {h.aghsShard && <span className="ok">아가님 샤드</span>}
        {s.items.backpack.length > 0 && <span>가방 {s.items.backpack.map((b) => state.names.items[b.name] ?? b.name).join(", ")}</span>}
      </div>
    </div>
  );
}
