import { useEffect, useMemo, useState } from "react";
import type { CoachState, HeroListItem } from "../types";
import { Img } from "./Img";
import { post } from "../useCoach";
import { useT, type Strings } from "../i18n";

/** One line saying where the enemy list came from, or what auto-detection is doing */
function detectionNote(enemies: string[], source: CoachState["enemySource"], d: CoachState["detection"], t: Strings): { text: string; tone: "ok" | "warn" | "muted" } | null {
  if (source === "manual") return { text: t.detSetByYou, tone: "muted" };
  if (source === "gsi") return { text: t.detFromGame, tone: "ok" };
  if (d.error) return { text: t.detError(d.error), tone: "warn" };
  if (d.calibration === "bad") {
    return { text: t.detBadCalibration, tone: "warn" };
  }
  const recent = d.lastAt > 0 && Date.now() - d.lastAt < 10_000;
  if (source === "vision") {
    const status = enemies.length === 5 ? t.detDone : t.detProgress(enemies.length);
    return { text: enemies.length ? `${status}. ${t.detVisionHint}` : status, tone: "ok" };
  }
  if (d.wanted && recent) return { text: t.detRunning, tone: "muted" };
  if (d.wanted) return { text: t.detTypeHere, tone: "muted" };
  return null;
}

/** GSI doesn't send enemy heroes while playing: they come from screen detection, game data when available, or you. */
export function EnemyPicker({ enemies, source, detection, rolePref, role }: {
  enemies: string[];
  source: CoachState["enemySource"];
  detection: CoachState["detection"];
  rolePref: "auto" | "core" | "support";
  role: "core" | "support";
}) {
  const t = useT();
  const [heroes, setHeroes] = useState<HeroListItem[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/heroes").then((r) => r.json()).then(setHeroes).catch(() => setHeroes([]));
  }, []);

  const byName = useMemo(() => new Map(heroes.map((h) => [h.name, h])), [heroes]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return heroes.filter((h) => !enemies.includes(h.name) && h.localizedName.toLowerCase().includes(t)).slice(0, 8);
  }, [q, heroes, enemies]);

  const save = (next: string[]) => post("/api/enemies", { heroes: next }).catch(() => undefined);
  const note = detectionNote(enemies, source, detection, t);
  const add = (name: string) => {
    if (enemies.length >= 5) return;
    save([...enemies, name]);
    setQ("");
  };

  return (
    <footer className="enemies">
      <div className="enemy-row">
        <span className="label">{t.enemies}</span>
        <ul className="chips">
          {enemies.map((e) => (
            <li key={e}>
              {byName.get(e) && <Img src={byName.get(e)!.icon} label={byName.get(e)!.localizedName} width={20} height={20} />}
              {byName.get(e)?.localizedName ?? e}
              <button aria-label={t.remove(byName.get(e)?.localizedName ?? e)} onClick={() => save(enemies.filter((x) => x !== e))}>×</button>
            </li>
          ))}
        </ul>
        {enemies.length < 5 && (
          <div className="picker">
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) add(matches[0].name); }}
              placeholder={enemies.length ? t.addHero : t.addEnemiesPlaceholder}
              aria-label={t.searchEnemies}
            />
            {open && matches.length > 0 && (
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
      {note && <p className={`detect-note ${note.tone}`} role="status">{note.text}</p>}
      <div className="role" role="radiogroup" aria-label={t.myRole}>
        <span className="label">{t.role}</span>
        {(["auto", "core", "support"] as const).map((r) => (
          <button
            key={r}
            role="radio"
            aria-checked={rolePref === r}
            className={rolePref === r ? "on" : ""}
            onClick={() => post("/api/role", { role: r })}
          >
            {r === "auto" ? t.autoRole(role === "core" ? t.core : t.support) : r === "core" ? t.core : t.support}
          </button>
        ))}
      </div>
    </footer>
  );
}
