import { useEffect, useRef, useState } from "react";
import type { Settings as SettingsT, SettingsView } from "../types";
import { playOverlaySound } from "../overlay/sounds";

const TIMER_LABELS: Record<string, string> = {
  bounty: "Bounty runes",
  power: "Power runes",
  wisdom: "Wisdom runes",
  lotus: "Lotus pools",
  daynight: "Day / night",
  stack: "Camp stack (x:53)",
  roshan: "Roshan respawn",
};
const SECTION_LABELS: Record<string, string> = {
  item: "Next item",
  skill: "Next skill",
  neutral: "Neutral item pick",
  alerts: "Danger alerts",
  enemies: "Enemy heroes",
  opponents: "Enemy players",
  timers: "Timers",
  ai: "AI summary",
  benchmark: "You vs average",
  rank: "Rank / MMR",
  draft: "Pick suggestions (draft)",
};
const TRIGGER_LABELS: [keyof SettingsT["ai"]["triggers"], string][] = [
  ["hero", "When my hero is locked in"],
  ["death", "After I die"],
  ["periodic", "Every 5 minutes"],
  ["enemies", "When the enemy lineup changes"],
  ["purchase", "When I buy something other than the suggestion"],
  ["respawn", "When I respawn"],
];

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
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
  const id = `r-${label.replace(/\W+/g, "-")}`;
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

  useEffect(() => {
    request<SettingsView>("GET", "/api/settings").then(setView).catch((e) => setError(e.message));
    return () => window.clearTimeout(timer.current);
  }, []);

  if (error && !view) return <div className="settings"><p className="error">{error}</p></div>;
  if (!view) return <div className="settings"><p className="muted">Loading settings…</p></div>;

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
        const next = await request<SettingsView>("PATCH", "/api/settings", body);
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
      setView(await request<SettingsView>("PUT", "/api/settings/api-key", { key: keyInput }));
      setKeyInput("");
      setKeyMsg({ ok: true, text: "Key saved. Use Test connection to check it." });
    } catch (e) {
      setKeyMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function removeKey() {
    setKeyMsg(null);
    try {
      setView(await request<SettingsView>("DELETE", "/api/settings/api-key"));
      setKeyMsg({ ok: true, text: "Key removed." });
    } catch (e) {
      setKeyMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function test() {
    setTesting(true);
    setKeyMsg(null);
    try {
      const r = await request<{ ok: boolean; model?: string; error?: string }>("POST", "/api/settings/test-ai");
      setKeyMsg(r.ok ? { ok: true, text: `Connected. ${r.model} is ready.` } : { ok: false, text: r.error ?? "Failed" });
    } catch (e) {
      setKeyMsg({ ok: false, text: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function reset() {
    if (!confirm("Reset all settings to their defaults? Your API key is kept.")) return;
    try {
      setView(await request<SettingsView>("POST", "/api/settings/reset"));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const keyText =
    view.apiKey.source === "settings" ? `Saved here, ending in ${view.apiKey.last4}`
    : view.apiKey.source === "env" ? `From .env${view.apiKey.last4 ? `, ending in ${view.apiKey.last4}` : ""}`
    : "Not set. AI advice stays off until you add one";

  return (
    <div className="settings">
      <header className="set-head">
        <h1>Settings</h1>
        <span className={`set-saved ${saved ? "on" : ""}`} role="status">{saved ? "Saved" : ""}</span>
        <button className="set-close" onClick={onClose}>Back to coach</button>
      </header>
      {ro && <p className="set-ro">You're viewing from another device. Settings can only be changed on the PC running Dota Coach.</p>}
      {error && <p className="error">{error}</p>}

      <section className="panel set-section">
        <h2>AI coach</h2>
        <div className="set-key">
          <div>
            <strong>Anthropic API key</strong>
            <p className={view.apiKey.source === "none" ? "warn" : "muted"}>{keyText}</p>
          </div>
          {!ro && (
            <form className="set-key-form" onSubmit={(e) => { e.preventDefault(); void saveKey(); }}>
              <label htmlFor="api-key" className="sr-only">API key</label>
              <input id="api-key" type="password" autoComplete="off" spellCheck={false}
                placeholder={view.apiKey.source === "none" ? "sk-ant-…" : "Paste a new key to replace it"}
                value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
              <button type="submit" className="primary" disabled={!keyInput.trim()}>Save key</button>
              <button type="button" onClick={test} disabled={testing || view.apiKey.source === "none"}>
                {testing ? "Testing…" : "Test connection"}
              </button>
              {view.apiKey.source === "settings" && <button type="button" onClick={removeKey}>Remove key</button>}
            </form>
          )}
          {keyMsg && <p className={keyMsg.ok ? "ok" : "error"} role="status">{keyMsg.text}</p>}
          <p className="muted small">Stored only on this PC (in <code>.data/secrets.json</code>) and never shown again. A key saved here overrides <code>.env</code>.</p>
        </div>

        <Toggle label="AI advice" checked={s.ai.enabled} disabled={ro} onChange={(v) => change({ ai: { enabled: v } })}
          hint="Off: only the rules and stats engine runs. Nothing is sent to the API" />

        <fieldset className="set-group" disabled={ro || !s.ai.enabled}>
          <legend>Model for in-game advice</legend>
          {view.options.models.map((m) => (
            <label key={m.id} className="set-radio">
              <input type="radio" name="liveModel" checked={s.ai.liveModel === m.id} onChange={() => change({ ai: { liveModel: m.id } })} />
              <span>{m.label}<small>{m.note}</small></span>
            </label>
          ))}
          <small className="muted">Used for automatic advice after picks, deaths and purchases, where a quick answer matters most.</small>
        </fieldset>

        <fieldset className="set-group" disabled={ro || !s.ai.enabled}>
          <legend>Model for your questions</legend>
          {view.options.models.map((m) => (
            <label key={m.id} className="set-radio">
              <input type="radio" name="model" checked={s.ai.model === m.id} onChange={() => change({ ai: { model: m.id } })} />
              <span>{m.label}<small>{m.note}</small></span>
            </label>
          ))}
        </fieldset>

        <fieldset className="set-group" disabled={ro || !s.ai.enabled}>
          <legend>Thinking depth</legend>
          <div className="set-seg" role="radiogroup">
            {view.options.efforts.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={s.ai.effort === e}
                className={s.ai.effort === e ? "on" : ""} onClick={() => change({ ai: { effort: e as SettingsT["ai"]["effort"] } })}>
                {e === "low" ? "Fast" : e === "medium" ? "Balanced" : "Deep"}
              </button>
            ))}
          </div>
          <small className="muted">Deeper takes longer to answer mid-game and costs more.</small>
        </fieldset>

        <fieldset className="set-group" disabled={ro || !s.ai.enabled}>
          <legend>Analyze automatically</legend>
          {TRIGGER_LABELS.map(([k, label]) => (
            <Toggle key={k} label={label} checked={s.ai.triggers[k]} onChange={(v) => change({ ai: { triggers: { [k]: v } } })} />
          ))}
          <Range label="At most once every" value={s.ai.autoIntervalSec} min={30} max={600} step={5} disabled={ro || !s.ai.enabled}
            format={(v) => (v < 60 ? `${v}s` : `${Math.floor(v / 60)}m${v % 60 ? ` ${v % 60}s` : ""}`)}
            onChange={(v) => change({ ai: { autoIntervalSec: v } })} />
          <small className="muted">Applies to the 5-minute check. Asking manually is never limited.</small>
        </fieldset>
      </section>

      <section className="panel set-section">
        <h2>Coaching</h2>
        <fieldset className="set-group" disabled={ro}>
          <legend>Default role</legend>
          <div className="set-seg" role="radiogroup">
            {(["auto", "core", "support"] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={s.coach.defaultRole === r}
                className={s.coach.defaultRole === r ? "on" : ""} onClick={() => change({ coach: { defaultRole: r } })}>
                {r === "auto" ? "Auto (from hero)" : r === "core" ? "Core" : "Support"}
              </button>
            ))}
          </div>
        </fieldset>
        <Range label="Low HP warning at" value={s.coach.lowHpPct} min={5} max={60} step={1} disabled={ro}
          format={(v) => `${v}%`} onChange={(v) => change({ coach: { lowHpPct: v } })} />
        <Range label="Remind me to spend gold at" value={s.coach.goldAlert} min={500} max={10000} step={100} disabled={ro}
          format={(v) => v.toLocaleString("en-US")} onChange={(v) => change({ coach: { goldAlert: v } })} />
        <fieldset className="set-group" disabled={ro}>
          <legend>Timers</legend>
          <div className="set-grid">
            {view.options.timers.map((t) => (
              <Toggle key={t} label={TIMER_LABELS[t] ?? t} checked={s.coach.timers[t] !== false}
                onChange={(v) => change({ coach: { timers: { [t]: v } } })} />
            ))}
          </div>
        </fieldset>
      </section>

      <section className="panel set-section">
        <h2>Overlay</h2>
        <fieldset className="set-group" disabled={ro}>
          <legend>Show in the overlay</legend>
          <div className="set-grid">
            {view.options.overlaySections.map((k) => (
              <Toggle key={k} label={SECTION_LABELS[k] ?? k} checked={s.overlay.sections[k] !== false}
                onChange={(v) => change({ overlay: { sections: { [k]: v } } })} />
            ))}
          </div>
        </fieldset>
        <Range label="Background opacity" value={s.overlay.opacity} min={0.3} max={1} step={0.01} disabled={ro}
          format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => change({ overlay: { opacity: v } })} />
        <Range label="Text size" value={s.overlay.scale} min={0.8} max={1.5} step={0.05} disabled={ro}
          format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => change({ overlay: { scale: v } })} />
        <Toggle label="Sound when the overlay opens and closes" checked={s.overlay.sound} disabled={ro}
          onChange={(v) => change({ overlay: { sound: v } })} hint="Arcane: an air sweep into a soft bell. Plays on Ctrl+Shift+H and the tray menu." />
        <Range label="Sound volume" value={s.overlay.soundVolume} min={0} max={1} step={0.05} disabled={ro || !s.overlay.sound}
          format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => change({ overlay: { soundVolume: v } })} />
        <div className="btns-inline">
          <button type="button" disabled={!s.overlay.sound} onClick={() => playOverlaySound("open", s.overlay.soundVolume)}>▶ Open sound</button>
          <button type="button" disabled={!s.overlay.sound} onClick={() => playOverlaySound("close", s.overlay.soundVolume)}>▶ Close sound</button>
        </div>
        <p className="muted small">Changes show up in the overlay right away. Move or resize it with Ctrl+Shift+L.</p>
      </section>

      <section className="panel set-section">
        <h2>Rank and MMR</h2>
        <div className="set-range">
          <label htmlFor="mmr">Exact MMR (optional)</label>
          <input id="mmr" type="number" inputMode="numeric" min={0} max={15000} step={1} disabled={ro}
            value={s.rank.mmr ?? ""} placeholder="Automatic"
            onChange={(e) => change({ rank: { mmr: e.target.value === "" ? null : Number(e.target.value) } })} />
        </div>
        <p className="muted small">
          Leave empty to collect it automatically (OpenDota's estimate from your ranked matches, refreshed after games).
          Dota only shows the exact number on your own profile, so type it here if you want exact figures.
        </p>
        <Toggle label="Update MMR after each game" checked={s.rank.autoAdjust} disabled={ro}
          onChange={(v) => change({ rank: { autoAdjust: v } })}
          hint="Wins add, losses subtract. The game can't tell ranked from unranked, so use Undo on the rank card after a normal or turbo game." />
        <Range label="MMR per game" value={s.rank.perGame} min={5} max={60} step={1} disabled={ro}
          format={(v) => `±${v}`} onChange={(v) => change({ rank: { perGame: v } })} />
      </section>

      <section className="panel set-section">
        <h2>Draft</h2>
        <div className="set-range">
          <label htmlFor="position">My position</label>
          <select id="position" disabled={ro} value={s.draft.position}
            onChange={(e) => change({ draft: { position: Number(e.target.value) as SettingsT["draft"]["position"] } })}>
            <option value={1}>1 · Carry (safe lane)</option>
            <option value={2}>2 · Mid</option>
            <option value={3}>3 · Offlane</option>
            <option value={4}>4 · Soft support</option>
            <option value={5}>5 · Hard support</option>
            <option value={0}>Any position</option>
          </select>
        </div>
        <p className="muted small">Pick suggestions before your hero is locked in fit this position and counter the enemy picks you add.</p>
      </section>

      <section className="panel set-section">
        <h2>Enemy auto-detection</h2>
        <Toggle label="Detect enemy heroes from the top bar" checked={s.detection.enabled} disabled={ro}
          onChange={(v) => change({ detection: { enabled: v } })}
          hint="Needs the overlay running and a one-time setup from its tray menu (Set up enemy detection…)" />
      </section>

      <section className="panel set-section">
        <h2>Match players</h2>
        <Toggle label="Show enemy players' rank, win rate and heroes" checked={s.matchInfo.enabled} disabled={ro}
          onChange={(v) => change({ matchInfo: { enabled: v } })}
          hint="Reads player IDs from Dota's server_log.txt. Current Dota clients stopped writing that file in 2022, so this usually stays empty." />
        <div className="set-range">
          <label htmlFor="log-path">server_log.txt path</label>
          <input id="log-path" type="text" spellCheck={false} disabled={ro} value={s.matchInfo.logPath}
            placeholder="Auto-detect from Steam libraries" maxLength={1000}
            onChange={(e) => change({ matchInfo: { logPath: e.target.value } })} />
        </div>
      </section>

      {!ro && (
        <footer className="set-foot">
          <button onClick={reset}>Reset to defaults</button>
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
