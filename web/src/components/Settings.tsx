import { useEffect, useId, useRef, useState } from "react";
import type { Settings as SettingsT, SettingsView } from "../types";
import { playOverlaySound } from "../overlay/sounds";
import { strings, useT } from "../i18n";

const TRIGGER_KEYS: (keyof SettingsT["ai"]["triggers"])[] = ["hero", "death", "periodic", "enemies", "purchase", "respawn"];

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

async function request<T>(method: string, path: string, body: unknown, failed: (status: number) => string): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? failed(res.status));
  return data as T;
}

function Toggle({ label, checked, onChange, disabled, hint }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string;
}) {
  return (
    <label className="set-toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

function Range({ label, value, min, max, step, format, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void; disabled?: boolean;
}) {
  // useId: labels are translated, and Korean text would reduce to the same id
  const id = `r-${useId()}`;
  return (
    <div className="set-range">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} />
      <output htmlFor={id}>{format(value)}</output>
    </div>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const pending = useRef<DeepPartial<SettingsT>>({});
  const timer = useRef<number | undefined>(undefined);
  const savedTimer = useRef<number | undefined>(undefined);
  const ctxT = useT();
  // Follow the language picked on this screen right away, before the server state round-trips
  const t = view ? strings(view.settings.language).set : ctxT.set;
  const common = view ? strings(view.settings.language) : ctxT;

  useEffect(() => {
    request<SettingsView>("GET", "/api/settings", undefined, t.requestFailed).then(setView).catch((e) => setError(e.message));
    return () => window.clearTimeout(timer.current);
  }, []);

  if (error && !view) return <div className="settings"><p className="error">{error}</p></div>;
  if (!view) return <div className="settings"><p className="muted">{t.loading}</p></div>;

  const s = view.settings;
  const ro = !view.canEdit;

  /** Update the screen immediately, save after a short pause (sliders fire on every pixel) */
  function change(patch: DeepPartial<SettingsT>) {
    setView((v) => (v ? { ...v, settings: deepMerge(v.settings, patch) } : v));
    pending.current = deepMerge(pending.current, patch);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const body = pending.current;
      pending.current = {};
      try {
        const next = await request<SettingsView>("PATCH", "/api/settings", body, t.requestFailed);
        setView(next);
        setError(null);
        setSaved(true);
        window.clearTimeout(savedTimer.current);
        savedTimer.current = window.setTimeout(() => setSaved(false), 1500);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 350);
  }

  async function saveKey() {
    setKeyMsg(null);
    try {
      setView(await request<SettingsView>("PUT", "/api/settings/api-key", { key: keyInput }, t.requestFailed));
      setKeyInput("");
      setKeyMsg({ ok: true, text: t.keySaved });
    } catch (e) {
      setKeyMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function removeKey() {
    setKeyMsg(null);
    try {
      setView(await request<SettingsView>("DELETE", "/api/settings/api-key", undefined, t.requestFailed));
      setKeyMsg({ ok: true, text: t.keyRemoved });
    } catch (e) {
      setKeyMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function test() {
    setTesting(true);
    setKeyMsg(null);
    try {
      const r = await request<{ ok: boolean; model?: string; error?: string }>("POST", "/api/settings/test-ai", undefined, t.requestFailed);
      setKeyMsg(r.ok ? { ok: true, text: t.connected(r.model ?? "") } : { ok: false, text: r.error ?? t.failed });
    } catch (e) {
      setKeyMsg({ ok: false, text: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function reset() {
    if (!confirm(t.resetConfirm)) return;
    try {
      setView(await request<SettingsView>("POST", "/api/settings/reset", undefined, t.requestFailed));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const keyText =
    view.apiKey.source === "settings" ? t.keySavedHere(view.apiKey.last4 ?? "")
    : view.apiKey.source === "env" ? t.keyFromEnv(view.apiKey.last4 ?? "")
    : t.keyNone;

  return (
    <div className="settings">
      <header className="set-head">
        <h1>{t.title}</h1>
        <span className={`set-saved ${saved ? "on" : ""}`} role="status">{saved ? t.saved : ""}</span>
        <button className="set-close" onClick={onClose}>{t.back}</button>
      </header>
      {ro && <p className="set-ro">{t.readOnly}</p>}
      {error && <p className="error">{error}</p>}

      <section className="panel set-section">
        <h2>{t.aiCoach}</h2>
        <div className="set-key">
          <div>
            <strong>{t.apiKey}</strong>
            <p className={view.apiKey.source === "none" ? "warn" : "muted"}>{keyText}</p>
          </div>
          {!ro && (
            <form className="set-key-form" onSubmit={(e) => { e.preventDefault(); void saveKey(); }}>
              <label htmlFor="api-key" className="sr-only">{t.apiKeyLabel}</label>
              <input id="api-key" type="password" autoComplete="off" spellCheck={false}
                placeholder={view.apiKey.source === "none" ? "sk-ant-…" : t.replaceKey}
                value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
              <button type="submit" className="primary" disabled={!keyInput.trim()}>{t.saveKey}</button>
              <button type="button" onClick={test} disabled={testing || view.apiKey.source === "none"}>
                {testing ? t.testing : t.test}
              </button>
              {view.apiKey.source === "settings" && <button type="button" onClick={removeKey}>{t.removeKey}</button>}
            </form>
          )}
          {keyMsg && <p className={keyMsg.ok ? "ok" : "error"} role="status">{keyMsg.text}</p>}
          <p className="muted small">{t.keyStoreBefore}<code>.data/secrets.json</code>{t.keyStoreMid}<code>.env</code>{t.keyStoreAfter}</p>
        </div>

        <Toggle label={t.aiAdvice} checked={s.ai.enabled} disabled={ro} onChange={(v) => change({ ai: { enabled: v } })}
          hint={t.aiAdviceHint} />

        <fieldset className="set-group" disabled={ro || !s.ai.enabled}>
          <legend>{t.liveModel}</legend>
          {view.options.models.map((m) => (
            <label key={m.id} className="set-radio">
              <input type="radio" name="liveModel" checked={s.ai.liveModel === m.id} onChange={() => change({ ai: { liveModel: m.id } })} />
              <span>{m.label}<small>{m.note}</small></span>
            </label>
          ))}
          <small className="muted">{t.liveModelHint}</small>
        </fieldset>

        <fieldset className="set-group" disabled={ro || !s.ai.enabled}>
          <legend>{t.askModel}</legend>
          {view.options.models.map((m) => (
            <label key={m.id} className="set-radio">
              <input type="radio" name="model" checked={s.ai.model === m.id} onChange={() => change({ ai: { model: m.id } })} />
              <span>{m.label}<small>{m.note}</small></span>
            </label>
          ))}
        </fieldset>

        <fieldset className="set-group" disabled={ro || !s.ai.enabled}>
          <legend>{t.effort}</legend>
          <div className="set-seg" role="radiogroup" aria-label={t.effort}>
            {view.options.efforts.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={s.ai.effort === e}
                className={s.ai.effort === e ? "on" : ""} onClick={() => change({ ai: { effort: e as SettingsT["ai"]["effort"] } })}>
                {e === "low" ? t.effortLow : e === "medium" ? t.effortMedium : t.effortHigh}
              </button>
            ))}
          </div>
          <small className="muted">{t.effortHint}</small>
        </fieldset>

        <fieldset className="set-group" disabled={ro || !s.ai.enabled}>
          <legend>{t.auto}</legend>
          {TRIGGER_KEYS.map((k) => (
            <Toggle key={k} label={t.triggers[k]} checked={s.ai.triggers[k]} onChange={(v) => change({ ai: { triggers: { [k]: v } } })} />
          ))}
          <Range label={t.interval} value={s.ai.autoIntervalSec} min={30} max={600} step={5} disabled={ro || !s.ai.enabled}
            format={t.duration}
            onChange={(v) => change({ ai: { autoIntervalSec: v } })} />
          <small className="muted">{t.intervalHint}</small>
        </fieldset>
      </section>

      <section className="panel set-section">
        <h2>{t.coaching}</h2>
        <fieldset className="set-group" disabled={ro}>
          <legend>{t.defaultRole}</legend>
          <div className="set-seg" role="radiogroup" aria-label={t.defaultRole}>
            {(["auto", "core", "support"] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={s.coach.defaultRole === r}
                className={s.coach.defaultRole === r ? "on" : ""} onClick={() => change({ coach: { defaultRole: r } })}>
                {r === "auto" ? t.autoFromHero : r === "core" ? common.core : common.support}
              </button>
            ))}
          </div>
        </fieldset>
        <Range label={t.lowHp} value={s.coach.lowHpPct} min={5} max={60} step={1} disabled={ro}
          format={(v) => `${v}%`} onChange={(v) => change({ coach: { lowHpPct: v } })} />
        <Range label={t.goldAlert} value={s.coach.goldAlert} min={500} max={10000} step={100} disabled={ro}
          format={(v) => v.toLocaleString(common.locale)} onChange={(v) => change({ coach: { goldAlert: v } })} />
        <fieldset className="set-group" disabled={ro}>
          <legend>{common.timers}</legend>
          <div className="set-grid">
            {view.options.timers.map((k) => (
              <Toggle key={k} label={t.timers[k] ?? k} checked={s.coach.timers[k] !== false}
                onChange={(v) => change({ coach: { timers: { [k]: v } } })} />
            ))}
          </div>
        </fieldset>
      </section>

      <section className="panel set-section">
        <h2>{t.overlay}</h2>
        <fieldset className="set-group" disabled={ro}>
          <legend>{t.showInOverlay}</legend>
          <div className="set-grid">
            {view.options.overlaySections.map((k) => (
              <Toggle key={k} label={t.sections[k] ?? k} checked={s.overlay.sections[k] !== false}
                onChange={(v) => change({ overlay: { sections: { [k]: v } } })} />
            ))}
          </div>
        </fieldset>
        <Range label={t.opacity} value={s.overlay.opacity} min={0.3} max={1} step={0.01} disabled={ro}
          format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => change({ overlay: { opacity: v } })} />
        <Range label={t.textSize} value={s.overlay.scale} min={0.8} max={1.5} step={0.05} disabled={ro}
          format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => change({ overlay: { scale: v } })} />
        <div className="set-range">
          <label htmlFor="language">{t.language}</label>
          <select id="language" disabled={ro} value={s.language}
            onChange={(e) => change({ language: e.target.value as SettingsT["language"] })}>
            <option value="ko">한국어</option>
            <option value="en">English</option>
          </select>
        </div>
        <p className="muted small">{t.languageHint}</p>
        <Toggle label={t.voice} checked={s.overlay.voice} disabled={ro}
          onChange={(v) => change({ overlay: { voice: v } })}
          hint={t.voiceHint} />
        <Toggle label={t.sound} checked={s.overlay.sound} disabled={ro}
          onChange={(v) => change({ overlay: { sound: v } })} hint={t.soundHint} />
        <Range label={t.volume} value={s.overlay.soundVolume} min={0} max={1} step={0.05} disabled={ro || !s.overlay.sound}
          format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => change({ overlay: { soundVolume: v } })} />
        <div className="btns-inline">
          <button type="button" disabled={!s.overlay.sound} onClick={() => playOverlaySound("open", s.overlay.soundVolume)}>{t.openSound}</button>
          <button type="button" disabled={!s.overlay.sound} onClick={() => playOverlaySound("close", s.overlay.soundVolume)}>{t.closeSound}</button>
        </div>
        <p className="muted small">{t.overlayHint}</p>
      </section>

      <section className="panel set-section">
        <h2>{t.rankMmr}</h2>
        <div className="set-range">
          <label htmlFor="mmr">{t.exactMmr}</label>
          <input id="mmr" type="number" inputMode="numeric" min={0} max={15000} step={1} disabled={ro}
            value={s.rank.mmr ?? ""} placeholder={t.automatic}
            onChange={(e) => change({ rank: { mmr: e.target.value === "" ? null : Number(e.target.value) } })} />
        </div>
        <p className="muted small">
          {t.mmrHint1} {t.mmrHint2}
        </p>
        <Toggle label={t.autoAdjust} checked={s.rank.autoAdjust} disabled={ro}
          onChange={(v) => change({ rank: { autoAdjust: v } })}
          hint={t.autoAdjustHint} />
        <Range label={t.perGame} value={s.rank.perGame} min={5} max={60} step={1} disabled={ro}
          format={(v) => `±${v}`} onChange={(v) => change({ rank: { perGame: v } })} />
      </section>

      <section className="panel set-section">
        <h2>{t.draft}</h2>
        <div className="set-range">
          <label htmlFor="position">{t.myPosition}</label>
          <select id="position" disabled={ro} value={s.draft.position}
            onChange={(e) => change({ draft: { position: Number(e.target.value) as SettingsT["draft"]["position"] } })}>
            <option value={1}>{t.pos1}</option>
            <option value={2}>{t.pos2}</option>
            <option value={3}>{t.pos3}</option>
            <option value={4}>{t.pos4}</option>
            <option value={5}>{t.pos5}</option>
            <option value={0}>{t.pos0}</option>
          </select>
        </div>
        <p className="muted small">{t.draftHint}</p>
      </section>

      <section className="panel set-section">
        <h2>{t.detection}</h2>
        <Toggle label={t.detect} checked={s.detection.enabled} disabled={ro}
          onChange={(v) => change({ detection: { enabled: v } })}
          hint={t.detectHint} />
      </section>

      <section className="panel set-section">
        <h2>{t.matchPlayers}</h2>
        <Toggle label={t.matchInfo} checked={s.matchInfo.enabled} disabled={ro}
          onChange={(v) => change({ matchInfo: { enabled: v } })}
          hint={t.matchInfoHint} />
        <div className="set-range">
          <label htmlFor="log-path">{t.logPath}</label>
          <input id="log-path" type="text" spellCheck={false} disabled={ro} value={s.matchInfo.logPath}
            placeholder={t.logPathPlaceholder} maxLength={1000}
            onChange={(e) => change({ matchInfo: { logPath: e.target.value } })} />
        </div>
      </section>

      {!ro && (
        <footer className="set-foot">
          <button onClick={reset}>{t.reset}</button>
        </footer>
      )}
    </div>
  );
}

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(patch as object)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(out[k] ?? {}, v) : v;
  }
  return out;
}
