import type { CoachState } from "../types";
import { Img } from "./Img";
import { gold as fmt, itemImg } from "../format";
import { useT } from "../i18n";

function Bar({ kind, value, max, pct }: { kind: "hp" | "mp"; value: number; max: number; pct: number }) {
  const t = useT();
  return (
    <div className={`bar ${kind}`} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={kind === "hp" ? t.health : t.mana}>
      <span style={{ width: `${pct}%` }} />
      <em>{value} / {max}</em>
    </div>
  );
}

export function HeroPanel({ state }: { state: CoachState }) {
  const t = useT();
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
          <span className="lvl">{t.level(h.level)}</span>
          {!h.alive && <span className="dead">{t.dead(h.respawnSeconds)}</span>}
        </div>
      </div>
      <Bar kind="hp" value={h.health} max={h.maxHealth} pct={h.healthPct} />
      <Bar kind="mp" value={h.mana} max={h.maxMana} pct={h.manaPct} />

      <dl className="stats">
        <div><dt>KDA</dt><dd>{r.stats.kda}</dd></div>
        <div><dt>{t.lhDn}</dt><dd>{p?.lastHits ?? 0} / {p?.denies ?? 0}</dd></div>
        <div><dt>{t.lhPerMin}</dt><dd>{r.stats.lhPerMin}</dd></div>
        <div><dt>GPM</dt><dd>{p?.gpm ?? 0}</dd></div>
        <div><dt>XPM</dt><dd>{p?.xpm ?? 0}</dd></div>
        <div><dt>{t.gold}</dt><dd className="gold">{fmt(p?.gold ?? 0)}</dd></div>
        <div className="wide"><dt>{t.netWorth}</dt><dd>{fmt(r.stats.netWorth)}</dd></div>
      </dl>

      <div className="inventory" aria-label={t.inventory}>
        {slots.map((it, i) =>
          it ? (
            <Img key={i} src={itemImg(it.name)} label={state.names.items[it.name] ?? it.name} />
          ) : (
            <span key={i} className="empty" aria-hidden />
          ),
        )}
      </div>
      <div className="extras">
        <span className={s.items.teleport ? "ok" : "missing"}>{s.items.teleport ? t.tpReady : t.noTp}</span>
        {h.aghsScepter && <span className="ok">Aghanim's Scepter</span>}
        {h.aghsShard && <span className="ok">Aghanim's Shard</span>}
        {s.items.backpack.length > 0 && <span>{t.backpack(s.items.backpack.map((b) => state.names.items[b.name] ?? b.name).join(", "))}</span>}
      </div>
    </div>
  );
}
