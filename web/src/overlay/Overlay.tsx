import { useEffect, useRef, useState } from "react";
import { playOverlaySound } from "./sounds";
import { useCoach, post } from "../useCoach";
import { Img } from "../components/Img";
import { abilityImg, clock, gold as fmt, heroIcon, itemImg } from "../format";
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

const SOURCE_LABEL = { ai: "AI pick", counter: "Counters enemy", meta: "Popular build", rule: "Basic" } as const;

/** One HUD row: a short label on the left, content on the right, so every row scans the same way */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="ov-sec">
      <span className="ov-label">{label}</span>
      <div className="ov-sec-body">{children}</div>
    </section>
  );
}

/** Status at a glance: go = act now (gold), ok = done/ahead (green), bad = behind (red), muted = later */
function Pill({ tone, children }: { tone: "go" | "ok" | "bad" | "muted"; children: React.ReactNode }) {
  return <span className={`ov-pill ${tone}`}>{children}</span>;
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

  // Keep the window as tall as the content while locked (unlocked, you size it yourself)
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    const fit = bridge()?.fitHeight;
    if (!el || !fit || !locked) return;
    // + the 6px margin on each side and a little slack
    const report = () => fit(Math.ceil(el.getBoundingClientRect().height) + 14);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [locked]);

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
    <div ref={rootRef} className={`ov ${locked ? "locked" : "unlocked"}`} style={style}>
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
          {/* 1. Danger first: the one thing that can't wait */}
          {show("alerts") && r.alerts.filter((a) => a.level === "danger").slice(0, 1).map((a) => (
            <p key={a.id} className="ov-alert" role="alert">{a.text}</p>
          ))}

          {/* 2. Buy: the main pick large, the next two small */}
          {show("item") && r.items[0] && (() => {
            const it = r.items[0];
            const g = s.player?.gold ?? 0;
            const pct = it.remaining === 0 ? 100 : Math.min(100, (g / it.remaining) * 100);
            const inProgress = it.reason.match(/In progress, (\d+)% built/);
            const why = inProgress ? `${inProgress[1]}% built` : SOURCE_LABEL[it.source];
            const offPlan = [...(state.purchases ?? [])].reverse().find((x) => !x.followed);
            const showOffPlan = offPlan && s.clockTime - offPlan.clock <= 60;
            return (
              <Section label="Buy">
                <div className={`ov-buy ${it.affordable ? "ready" : ""}`}>
                  <Img src={it.img} label={it.name} width={40} height={29} />
                  <div className="ov-buy-main">
                    <div className="ov-line">
                      <strong>{it.name}</strong>
                      <Pill tone={it.affordable ? "go" : "muted"}>{it.affordable ? "Buy now" : `${fmt(Math.max(0, it.remaining - g))} more`}</Pill>
                    </div>
                    <div className="ov-bar"><span style={{ width: `${pct}%` }} /></div>
                    <small className="ov-why">{why}</small>
                  </div>
                </div>
                {r.items.length > 1 && (
                  <div className="ov-then">
                    <span className="ov-then-label">Then</span>
                    {r.items.slice(1, 3).map((n) => (
                      <span key={n.key} className={`ov-then-item ${n.affordable ? "ready" : ""}`}>
                        <Img src={n.img} label={n.name} width={22} height={16} />
                        {n.name}
                      </span>
                    ))}
                  </div>
                )}
                {showOffPlan && (
                  <small className="ov-note">
                    Bought {offPlan!.name}
                    {offPlan!.replaced.length ? ` instead of ${offPlan!.replaced.map((k) => state.names.items[k] ?? k).join(", ")}` : ""}, plan updated
                  </small>
                )}
              </Section>
            );
          })()}

          {/* 3. Skill: the point to spend now, or the next real pick and when */}
          {show("skill") && (r.skills.next || r.skills.upcoming) && (() => {
            const sk = r.skills.next ?? r.skills.upcoming!;
            const now = Boolean(r.skills.next);
            const order = r.skills.priority.slice(0, 3);
            const name = state.names.abilities[sk.key] ?? sk.name;
            return (
              <Section label="Skill">
                <div className={`ov-item ${now ? "" : "later"}`}>
                  {sk.kind === "ability"
                    ? <Img src={abilityImg(sk.key)} label={name} width={26} height={26} />
                    : <span className="ov-star" aria-hidden>★</span>}
                  <div className="ov-item-main">
                    <b>{name}</b>
                    {sk.options?.length ? <small>{sk.options.map((o) => o.name).join(" / ")}</small> : null}
                  </div>
                  <Pill tone={now ? "go" : "muted"}>
                    {now ? (r.skills.unspent > 1 ? `Now ×${r.skills.unspent}` : "Now") : `Lv ${r.skills.upcoming!.atLevel}`}
                  </Pill>
                </div>
                {order.length > 1 && (
                  <div className="ov-order" aria-label="Skill maxing order">
                    <span className="ov-then-label">Max</span>
                    {order.map((k, i) => (
                      <span key={k} className="ov-order-step">
                        {i > 0 && <i aria-hidden>›</i>}
                        <Img src={abilityImg(k)} label={state.names.abilities[k] ?? k} width={16} height={16} />
                      </span>
                    ))}
                  </div>
                )}
              </Section>
            );
          })()}

          {/* 4. Neutral item for the open tier */}
          {show("neutral") && r.neutral?.pick && (
            <Section label="Neutral">
              <div className={`ov-item ${r.neutral.pick.held ? "later" : ""}`}>
                <Img src={itemImg(r.neutral.pick.key)} label={r.neutral.pick.name} width={26} height={19} />
                <div className="ov-item-main"><b>{r.neutral.pick.name}</b></div>
                <Pill tone={r.neutral.pick.held ? "ok" : "go"}>{r.neutral.pick.held ? `T${r.neutral.tier} ✓ have` : `T${r.neutral.tier} pick`}</Pill>
              </div>
            </Section>
          )}

          {/* 5. Pace: you vs the average at this minute, worst first */}
          {show("benchmark") && state.benchmark && <StatsCompareCompact b={state.benchmark} />}

          {show("enemies") && state.enemies.length > 0 && (
            <Section label="Enemy">
              <div className="ov-enemies" aria-label="Enemy heroes">
                {state.enemies.map((e) => (
                  <Img key={e} src={heroIcon(e)} label={e.replace("npc_dota_hero_", "")} width={20} height={20} />
                ))}
                {state.enemySource === "vision" && state.enemies.length < 5 && <small>detecting…</small>}
              </div>
            </Section>
          )}

          {show("opponents") && state.match && state.match.enemies.length > 0 && <OpponentsPanel match={state.match} />}

          {/* 6. Timers */}
          {show("timers") && r.timers.length > 0 && (
            <Section label="Next">
              <div className="ov-timers">
                {r.timers.slice(0, 2).map((t) => (
                  <span key={t.id} className={t.inSeconds <= 15 ? "soon" : ""}>
                    {t.label} <b>{clock(t.inSeconds)}</b>
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* 7. Coach: the AI read, only while it still fits the game */}
          {show("ai") && state.ai.enabled && (() => {
            // Advice is a snapshot of one moment. On the HUD it only stays while it still describes the game:
            // up to 90 game-seconds (3 minutes for a question you asked), and never a death read once you're alive.
            const a = state.ai.advice;
            const age = a ? s.clockTime - a.clock : 0;
            const fresh = a && age <= (a.reason === "manual" ? 180 : 90) && !(a.reason === "death" && s.hero!.alive && age > 5 && /\bdead\b|\bdied\b/i.test(a.summary));
            if (!state.ai.pending && !state.ai.error && !fresh) return null;
            return (
              <div className={`ov-ai ${fresh ? a!.danger : ""}`}>
                <div className="ov-ai-head">
                  <span className="ov-label">Coach</span>
                  {state.ai.pending ? <small className="ov-pending">thinking…</small> : fresh && age >= 20 ? <small className="ov-age">{clock(age)} ago</small> : null}
                </div>
                {state.ai.error ? (
                  <p className="ov-err">{state.ai.error}</p>
                ) : fresh ? (
                  <p>{a!.summary}</p>
                ) : null}
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
