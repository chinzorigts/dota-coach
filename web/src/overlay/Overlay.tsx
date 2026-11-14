import { useEffect, useState } from "react";
import { useCoach, post } from "../useCoach";
import { Img } from "../components/Img";
import { abilityImg, clock, gold as fmt, heroIcon } from "../format";
import { bridge, type OverlayMode } from "./bridge";
import { OpponentsPanel } from "./OpponentsPanel";
import { StatsCompareCompact } from "../components/StatsCompare";
import { RankLine } from "../components/RankCard";
import { DraftCompact } from "../components/DraftPanel";

/** What the game is doing before your hero is in, so "waiting" never looks like "can't see the game" */
function idleText(connected: boolean, gameState: string | undefined, gsiAgeMs: number | null): string {
  if (!connected) return "Dota Coach: server offline";
  if (gsiAgeMs === null || gsiAgeMs > 75_000) return "Dota Coach: waiting for Dota 2";
  switch (gameState) {
    case "DOTA_GAMERULES_STATE_HERO_SELECTION":
    case "DOTA_GAMERULES_STATE_CUSTOM_GAME_SETUP":
      return "Hero selection";
    case "DOTA_GAMERULES_STATE_STRATEGY_TIME":
      return "Strategy time";
    case "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD":
    case "DOTA_GAMERULES_STATE_INIT":
      return "Loading the match…";
    case "DOTA_GAMERULES_STATE_POST_GAME":
      return "Game over";
    default:
      return "Connected · waiting for a match";
  }
}

/**
 * Compact HUD drawn over the game. Everything here must be readable in a glance,
 * so it shows only what changes a decision: next buy, next skill, danger, the nearest timers, AI summary.
 */
export function Overlay() {
  const { state, connected } = useCoach();
  // In a plain browser (no Electron) treat it as unlocked so the page is usable for previews.
  const [locked, setLocked] = useState(Boolean(bridge()));
  const [hk, setHk] = useState<OverlayMode["hotkeys"] | null>(null);
  const [calibrated, setCalibrated] = useState(true);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("overlay-root");
    return bridge()?.onMode((m) => {
      setLocked(m.locked);
      setHk(m.hotkeys);
      setCalibrated(m.calibrated);
    });
  }, []);

  const s = state?.snapshot;
  const r = state?.report;

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

  const ov = state?.settings.overlay;
  const show = (k: string) => ov?.sections[k] !== false;
  const style = ov
    ? ({ "--ov-alpha": ov.opacity, zoom: ov.scale } as React.CSSProperties)
    : undefined;

  return (
    <div className={`ov ${locked ? "locked" : "unlocked"}`} style={style}>
      {!locked && (
        <div className="ov-handle">
          <span>Drag to move, resize from the edges</span>
          {hk && <span>{hk.lock} to lock</span>}
        </div>
      )}

      {!connected || !s?.hero || !r ? (
        <>
          <p className="ov-idle">{idleText(connected, state?.snapshot?.gameState, state?.lastGsiAt ? Date.now() - state.lastGsiAt : null)}</p>
          {/* The lobby is known from match accept, before heroes are picked */}
          {connected && state?.match && show("opponents") && <OpponentsPanel match={state.match} />}
          {connected && state?.draft && show("draft") && <DraftCompact draft={state.draft} />}
          {connected && state && show("rank") && <RankLine rank={state.rank} />}
        </>
      ) : (
        <>
          {show("item") && r.items[0] && (() => {
            const it = r.items[0];
            const g = s.player?.gold ?? 0;
            const pct = it.remaining === 0 ? 100 : Math.min(100, (g / it.remaining) * 100);
            return (
              <div className={`ov-row ${it.affordable ? "ready" : ""}`}>
                <Img src={it.img} label={it.name} width={44} height={32} />
                <div className="ov-main">
                  <div className="ov-line">
                    <strong>{it.name}</strong>
                    <span className="ov-gold">{it.affordable ? "Buy now" : `${fmt(Math.max(0, it.remaining - g))} more`}</span>
                  </div>
                  <div className="ov-bar"><span style={{ width: `${pct}%` }} /></div>
                </div>
              </div>
            );
          })()}

          {show("item") && (() => {
            // For a minute of game time after an off-plan buy, say that the list adapted to it
            const p = [...(state.purchases ?? [])].reverse().find((x) => !x.followed);
            if (!p || s.clockTime - p.clock > 60) return null;
            const was = p.replaced.map((k) => state.names.items[k] ?? k).join(", ");
            return <p className="ov-offplan">Bought {p.name}{was ? ` over ${was}` : ""}: plan updated</p>;
          })()}

          {show("skill") && (r.skills.next || r.skills.upcoming) && (() => {
            // Its own box, apart from items: the point to spend now, or what to take at the next level
            const sk = r.skills.next ?? r.skills.upcoming!;
            const now = Boolean(r.skills.next);
            const order = r.skills.priority.slice(0, 3);
            return (
              <div className={`ov-skill ${now ? "now" : ""}`}>
                <div className="ov-row skill">
                  {sk.kind === "ability" ? (
                    <Img src={abilityImg(sk.key)} label={state.names.abilities[sk.key] ?? sk.name} width={32} height={32} />
                  ) : (
                    <span className="ov-star" aria-hidden>★</span>
                  )}
                  <div className="ov-main">
                    <small className="ov-skill-when">{now ? `Skill point${r.skills.unspent > 1 ? ` ×${r.skills.unspent}` : ""}` : `At level ${r.skills.upcoming!.atLevel}`}</small>
                    <strong>{state.names.abilities[sk.key] ?? sk.name}</strong>
                    {sk.options?.length ? <small>{sk.options.map((o) => o.name).join(" / ")}</small> : null}
                  </div>
                </div>
                {order.length > 1 && (
                  <div className="ov-skill-order" aria-label="Skill maxing order">
                    {order.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <i aria-hidden>›</i>}
                        <Img src={abilityImg(k)} label={state.names.abilities[k] ?? k} width={18} height={18} />
                      </span>
                    ))}
                    <small>max order</small>
                  </div>
                )}
              </div>
            );
          })()}

          {show("alerts") && r.alerts.filter((a) => a.level === "danger").slice(0, 2).map((a) => (
            <p key={a.id} className="ov-alert">{a.text}</p>
          ))}

          {show("enemies") && state.enemies.length > 0 && (
            <div className="ov-enemies" aria-label="Enemy heroes">
              {state.enemies.map((e) => (
                <Img key={e} src={heroIcon(e)} label={e.replace("npc_dota_hero_", "")} width={22} height={22} />
              ))}
              {state.enemySource === "vision" && state.enemies.length < 5 && <small>detecting…</small>}
            </div>
          )}

          {show("opponents") && state.match && state.match.enemies.length > 0 && <OpponentsPanel match={state.match} />}

          {show("benchmark") && state.benchmark && <StatsCompareCompact b={state.benchmark} />}

          {show("timers") && r.timers.length > 0 && (
            <div className="ov-timers">
              {r.timers.slice(0, 2).map((t) => (
                <span key={t.id} className={t.inSeconds <= 15 ? "soon" : ""}>
                  {t.label} <b>{clock(t.inSeconds)}</b>
                </span>
              ))}
            </div>
          )}

          {show("ai") && state.ai.enabled && (() => {
            // Advice is a snapshot of one moment. On the HUD it only stays while it still describes the game:
            // up to 90 game-seconds (3 minutes for a question you asked), and never a death read once you're alive.
            const a = state.ai.advice;
            const age = a ? s.clockTime - a.clock : 0;
            const fresh = a && age <= (a.reason === "manual" ? 180 : 90) && !(a.reason === "death" && s.hero!.alive && age > 5 && /\bdead\b|\bdied\b/i.test(a.summary));
            if (!state.ai.pending && !state.ai.error && !fresh) return null;
            return (
              <div className={`ov-ai ${fresh ? a!.danger : ""}`}>
                {state.ai.pending ? (
                  <p className="ov-pending">AI is thinking…</p>
                ) : state.ai.error ? (
                  <p className="ov-err">{state.ai.error}</p>
                ) : (
                  <p>{a!.summary}{age >= 20 && <small className="ov-age"> · {clock(age)} ago</small>}</p>
                )}
              </div>
            );
          })()}

          {!locked && state.ai.enabled && (
            <form className="ov-ask" onSubmit={ask}>
              <label htmlFor="ov-q" className="sr-only">Ask the AI coach</label>
              <input id="ov-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the coach…" maxLength={500} />
              <button type="submit" disabled={Boolean(state.ai.pending)}>Ask</button>
            </form>
          )}
          {err && <p className="ov-err">{err}</p>}
          {!locked && !calibrated && state.enemySource !== "manual" && (
            <p className="ov-keys">Enemy auto-detect is off. Tray menu → Set up enemy detection</p>
          )}
          {!locked && hk && <p className="ov-keys">{hk.toggle} hide · {hk.ask} quick ask</p>}
        </>
      )}
    </div>
  );
}
