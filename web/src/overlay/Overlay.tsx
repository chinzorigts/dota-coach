import { useEffect, useRef, useState } from "react";
import { playOverlaySound } from "./sounds";
import { useCoach, post } from "../useCoach";
import { Img } from "../components/Img";
import { abilityImg, clock, gold as fmt, heroIcon } from "../format";
import { bridge, type OverlayMode } from "./bridge";
import { OpponentsPanel } from "./OpponentsPanel";

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

  // Open/close sound on hotkey or tray toggle. Settings live in a ref so the listener is registered once.
  const sound = useRef({ on: true, volume: 0.6 });
  sound.current = { on: state?.settings.overlay.sound ?? true, volume: state?.settings.overlay.soundVolume ?? 0.6 };
  useEffect(
    () =>
      bridge()?.onVisibility?.(({ visible }) => {
        if (sound.current.on) playOverlaySound(visible ? "open" : "close", sound.current.volume);
      }),
    [],
  );

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
          <p className="ov-idle">{!connected ? "Dota Coach: server offline" : "Dota Coach: waiting for a game"}</p>
          {/* The lobby is known from match accept, before heroes are picked */}
          {connected && state?.match && show("opponents") && <OpponentsPanel match={state.match} />}
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

          {show("skill") && r.skills.next && (
            <div className="ov-row skill">
              {r.skills.next.kind === "ability" ? (
                <Img src={abilityImg(r.skills.next.key)} label={state.names.abilities[r.skills.next.key] ?? r.skills.next.name} width={32} height={32} />
              ) : (
                <span className="ov-star" aria-hidden>★</span>
              )}
              <div className="ov-main">
                <strong>{state.names.abilities[r.skills.next.key] ?? r.skills.next.name}</strong>
                {r.skills.next.options?.length ? (
                  <small>{r.skills.next.options.map((o) => o.name).join(" / ")}</small>
                ) : null}
              </div>
            </div>
          )}

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

          {show("timers") && r.timers.length > 0 && (
            <div className="ov-timers">
              {r.timers.slice(0, 2).map((t) => (
                <span key={t.id} className={t.inSeconds <= 15 ? "soon" : ""}>
                  {t.label} <b>{clock(t.inSeconds)}</b>
                </span>
              ))}
            </div>
          )}

          {show("ai") && state.ai.enabled && (state.ai.advice || state.ai.pending || state.ai.error) && (
            <div className={`ov-ai ${state.ai.advice?.danger ?? ""}`}>
              {state.ai.pending ? (
                <p className="ov-pending">AI is thinking…</p>
              ) : state.ai.error ? (
                <p className="ov-err">{state.ai.error}</p>
              ) : (
                <p>{state.ai.advice!.summary}</p>
              )}
            </div>
          )}

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
