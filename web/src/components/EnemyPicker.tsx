import { useEffect, useMemo, useState } from "react";
import type { CoachState, HeroListItem } from "../types";
import { Img } from "./Img";
import { post } from "../useCoach";

/** One line saying where the enemy list came from, or what auto-detection is doing */
function detectionNote(enemies: string[], source: CoachState["enemySource"], d: CoachState["detection"]): { text: string; tone: "ok" | "warn" | "muted" } | null {
  if (source === "manual") return { text: "Set by you. Remove all to switch back to auto-detect", tone: "muted" };
  if (source === "gsi") return { text: "From game data", tone: "ok" };
  if (d.error) return { text: `Auto-detect: ${d.error}`, tone: "warn" };
  if (d.calibration === "bad") {
    return { text: "Auto-detect can't find your hero in your team's row. Recalibrate from the overlay's tray menu", tone: "warn" };
  }
  const recent = d.lastAt > 0 && Date.now() - d.lastAt < 10_000;
  if (source === "vision") {
    return { text: enemies.length === 5 ? "Auto-detected from the top bar" : `Auto-detecting… ${enemies.length}/5`, tone: "ok" };
  }
  if (d.wanted && recent) return { text: "Auto-detecting from the top bar…", tone: "muted" };
  if (d.wanted) return { text: "Type enemies here, or run the overlay (npm run overlay) to auto-detect them", tone: "muted" };
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
  const note = detectionNote(enemies, source, detection);
  const add = (name: string) => {
    if (enemies.length >= 5) return;
    save([...enemies, name]);
    setQ("");
  };

  return (
    <footer className="enemies">
      <div className="enemy-row">
        <span className="label">Enemies</span>
        <ul className="chips">
          {enemies.map((e) => (
            <li key={e}>
              {byName.get(e) && <Img src={byName.get(e)!.icon} label={byName.get(e)!.localizedName} width={20} height={20} />}
              {byName.get(e)?.localizedName ?? e}
              <button aria-label={`Remove ${byName.get(e)?.localizedName ?? e}`} onClick={() => save(enemies.filter((x) => x !== e))}>×</button>
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
              placeholder={enemies.length ? "Add hero" : "Add enemy heroes to get counter-item picks"}
              aria-label="Search enemy heroes"
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
      <div className="role" role="radiogroup" aria-label="My role">
        <span className="label">Role</span>
        {(["auto", "core", "support"] as const).map((r) => (
          <button
            key={r}
            role="radio"
            aria-checked={rolePref === r}
            className={rolePref === r ? "on" : ""}
            onClick={() => post("/api/role", { role: r })}
          >
            {r === "auto" ? `Auto (${role === "core" ? "core" : "support"})` : r === "core" ? "Core" : "Support"}
          </button>
        ))}
      </div>
    </footer>
  );
}
