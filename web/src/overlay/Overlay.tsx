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
import { strings, type Strings } from "./i18n";
import { hasVoice, speak } from "./voice";
import { ReviewCompact } from "../components/ReviewCard";

/** What the game is doing before your hero is in, so "waiting" never looks like "can't see the game" */
function idleText(T: Strings, connected: boolean, gameState: string | undefined, gsiAgeMs: number | null): string {
  if (!connected) return T.offline;
  if (gsiAgeMs === null || gsiAgeMs > 75_000) return T.waitingDota;
  switch (gameState) {
    case "DOTA_GAMERULES_STATE_HERO_SELECTION":
    case "DOTA_GAMERULES_STATE_CUSTOM_GAME_SETUP":
      return T.heroSelection;
    case "DOTA_GAMERULES_STATE_STRATEGY_TIME":
      return T.strategy;
    case "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD":
    case "DOTA_GAMERULES_STATE_INIT":
      return T.loading;
    case "DOTA_GAMERULES_STATE_POST_GAME":
      return T.gameOver;
    default:
      return T.waitingMatch;
  }
}

const RUNE_EN: Record<string, string> = { bounty: "Bounty rune", power: "Power rune", wisdom: "Wisdom rune", lotus: "Lotus", roshan: "Roshan" };

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
  // Two renders a second at most: purchases and timers still show within half a second, with far fewer repaints
  const { state, connected } = useCoach(500);
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
  const lang = state?.settings.language ?? "ko";
  const T = strings(lang);

  // Spoken alerts. Each fires on the change, not while the state lasts: a rune 15s out, health dropping into
  // danger, the main item becoming affordable, a skill point appearing, and each new AI summary.
  const said = useRef({ timers: new Set<string>(), lowHp: false, buy: "", skill: false, advice: 0, match: "" });
  useEffect(() => {
    const o = state?.settings.overlay;
    if (!o?.voice || !s?.hero || !r || !s.inProgress) return;
    const m = said.current;
    const match = (s.matchId ?? "") + s.hero.name;
    if (m.match !== match) said.current = { timers: new Set(), lowHp: false, buy: "", skill: false, advice: state?.ai.advice?.at ?? 0, match };
    const mem = said.current;
    const E = strings("en");
    const vol = o.soundVolume;
    const lowHp = r.alerts.some((a) => a.id === "low-hp");
    if (lowHp && !mem.lowHp) speak(T.sayLowHp, lang, vol, { fallback: E.sayLowHp, urgent: true });
    mem.lowHp = lowHp;
    for (const t of r.timers) {
      if (!["bounty", "power", "wisdom", "lotus", "roshan"].includes(t.id)) continue;
      const key = t.id + ":" + Math.round((s.clockTime + t.inSeconds) / 10);
      if (t.inSeconds <= 15 && t.inSeconds >= 8 && !mem.timers.has(key)) {
        mem.timers.add(key);
        speak(T.sayRune(t.label, 15), lang, vol, { fallback: E.sayRune(RUNE_EN[t.id] ?? t.id, 15) });
      }
    }
    const top = r.items[0];
    if (top?.affordable && mem.buy !== top.key) speak(T.sayBuy(top.name), lang, vol, { fallback: E.sayBuy(top.name) });
    mem.buy = top?.affordable ? top.key : "";
    const skill = Boolean(r.skills.next);
    if (skill && !mem.skill) speak(T.saySkill, lang, vol, { fallback: E.saySkill });
    mem.skill = skill;
    const adv = state?.ai.advice;
    if (adv && adv.at !== mem.advice) {
      mem.advice = adv.at;
      // The summary is written in the chosen language; without a voice for it there is nothing sensible to read
      if (hasVoice(lang)) speak(adv.summary, lang, vol);
    }
  }, [state]);

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
      {locked && bridge()?.setInteractive && (
        // Drag from here any time; the rest of the overlay stays click-through. Hovering makes it take the mouse.
        <div
          className="ov-grip"
          title="Drag to move (tray menu: Move overlay to…)"
          aria-label="Drag to move the overlay"
        >
          <i aria-hidden />
        </div>
      )}
      {!locked && (
        <div className="ov-handle">
          <span>{T.dragHint}</span>
          {hk && <span>{T.toLock(hk.lock)}</span>}
        </div>
      )}

      {!connected || !s?.hero || !r ? (
        <>
          <p className="ov-idle">{idleText(T, connected, state?.snapshot?.gameState, state?.lastGsiAt ? Date.now() - state.lastGsiAt : null)}</p>
          {/* The lobby is known from match accept, before heroes are picked */}
          {connected && state?.match && show("opponents") && <OpponentsPanel match={state.match} />}
          {connected && state && (state.review || state.reviewStatus === "pending") && show("ai") && (
            <ReviewCompact review={state.review} status={state.reviewStatus} label={T.review} lang={lang} />
          )}
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
            const why = inProgress ? T.built(inProgress[1]) : T.source[it.source];
            const offPlan = [...(state.purchases ?? [])].reverse().find((x) => !x.followed);
            const showOffPlan = offPlan && s.clockTime - offPlan.clock <= 60;
            return (
              <Section label={T.buy}>
                <div className={`ov-buy ${it.affordable ? "ready" : ""}`}>
                  <Img src={it.img} label={it.name} width={40} height={29} />
                  <div className="ov-buy-main">
                    <div className="ov-line">
                      <strong>{it.name}</strong>
                      <Pill tone={it.affordable ? "go" : "muted"}>{it.affordable ? T.buyNow : T.more(fmt(Math.max(0, it.remaining - g)))}</Pill>
                    </div>
                    <div className="ov-bar"><span style={{ width: `${pct}%` }} /></div>
                    <small className="ov-why">{why}</small>
                  </div>
                </div>
                {r.items.length > 1 && (
                  <div className="ov-then">
                    <span className="ov-then-label">{T.then}</span>
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
                    {T.bought(offPlan!.name, offPlan!.replaced.map((k) => state.names.items[k] ?? k).join(", "))}
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
            const tier = sk.key.match(/^talent_tier_(\d+)$/);
            const name = tier ? T.talent(Number(tier[1])) : (state.names.abilities[sk.key] ?? sk.name);
            return (
              <Section label={T.skill}>
                <div className={`ov-item ${now ? "" : "later"}`}>
                  {sk.kind === "ability"
                    ? <Img src={abilityImg(sk.key)} label={name} width={26} height={26} />
                    : <span className="ov-star" aria-hidden>★</span>}
                  <div className="ov-item-main">
                    <b>{name}</b>
                    {sk.options?.length ? <small>{sk.options.map((o) => o.name).join(" / ")}</small> : null}
                  </div>
                  <Pill tone={now ? "go" : "muted"}>
                    {now ? T.now(r.skills.unspent) : T.atLevel(r.skills.upcoming!.atLevel)}
                  </Pill>
                </div>
                {order.length > 1 && (
                  <div className="ov-order" aria-label="Skill maxing order">
                    <span className="ov-then-label">{T.max}</span>
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
            <Section label={T.neutral}>
              <div className={`ov-item ${r.neutral.pick.held ? "later" : ""}`}>
                <Img src={itemImg(r.neutral.pick.key)} label={r.neutral.pick.name} width={26} height={19} />
                <div className="ov-item-main"><b>{r.neutral.pick.name}</b></div>
                <Pill tone={r.neutral.pick.held ? "ok" : "go"}>{r.neutral.pick.held ? T.have(r.neutral.tier) : T.pick(r.neutral.tier)}</Pill>
              </div>
            </Section>
          )}

          {/* 5. Pace: you vs the average at this minute, worst first */}
          {show("benchmark") && state.benchmark && <StatsCompareCompact b={state.benchmark} label={T.pace} />}

          {show("enemies") && state.enemies.length > 0 && (
            <Section label={T.enemy}>
              <div className="ov-enemies" aria-label="Enemy heroes">
                {state.enemies.map((e) => (
                  <Img key={e} src={heroIcon(e)} label={e.replace("npc_dota_hero_", "")} width={20} height={20} />
                ))}
                {state.enemySource === "vision" && state.enemies.length < 5 && <small>{T.detecting}</small>}
              </div>
            </Section>
          )}

          {show("opponents") && state.match && state.match.enemies.length > 0 && <OpponentsPanel match={state.match} />}

          {/* 6. Timers */}
          {show("timers") && r.timers.length > 0 && (
            <Section label={T.next}>
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
            const fresh = a && age <= (a.reason === "manual" ? 180 : 90) && !(a.reason === "death" && s.hero!.alive && age > 5 && /\bdead\b|\bdied\b|죽|사망/i.test(a.summary));
            if (!state.ai.pending && !state.ai.error && !fresh) return null;
            return (
              <div className={`ov-ai ${fresh ? a!.danger : ""}`}>
                <div className="ov-ai-head">
                  <span className="ov-label">{T.coach}</span>
                  {state.ai.pending ? <small className="ov-pending">{T.thinking}</small> : fresh && age >= 20 ? <small className="ov-age">{T.ago(clock(age))}</small> : null}
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
              <input id="ov-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T.askPlaceholder} maxLength={500} />
              <button type="submit" disabled={Boolean(state.ai.pending)}>{T.ask}</button>
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
