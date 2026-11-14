import { useEffect, useMemo, useState } from "react";
import type { HeroListItem } from "../types";
import { Img } from "./Img";
import { post } from "../useCoach";

/** 플레이 중 GSI 는 적 영웅을 주지 않아서 직접 고른다. 매치가 바뀌면 서버가 비운다. */
export function EnemyPicker({ enemies, rolePref, role }: { enemies: string[]; rolePref: "auto" | "core" | "support"; role: "core" | "support" }) {
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
  const add = (name: string) => {
    if (enemies.length >= 5) return;
    save([...enemies, name]);
    setQ("");
  };

  return (
    <footer className="enemies">
      <div className="enemy-row">
        <span className="label">적 영웅</span>
        <ul className="chips">
          {enemies.map((e) => (
            <li key={e}>
              {byName.get(e) && <Img src={byName.get(e)!.icon} label={byName.get(e)!.localizedName} width={20} height={20} />}
              {byName.get(e)?.localizedName ?? e}
              <button aria-label={`${byName.get(e)?.localizedName ?? e} 빼기`} onClick={() => save(enemies.filter((x) => x !== e))}>×</button>
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
              placeholder={enemies.length ? "영웅 추가 (영문)" : "적 영웅을 넣으면 카운터 아이템을 추천합니다 (영문 이름)"}
              aria-label="적 영웅 검색"
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
      <div className="role" role="radiogroup" aria-label="내 역할">
        <span className="label">역할</span>
        {(["auto", "core", "support"] as const).map((r) => (
          <button
            key={r}
            role="radio"
            aria-checked={rolePref === r}
            className={rolePref === r ? "on" : ""}
            onClick={() => post("/api/role", { role: r })}
          >
            {r === "auto" ? `자동 (${role === "core" ? "코어" : "서포터"})` : r === "core" ? "코어" : "서포터"}
          </button>
        ))}
      </div>
    </footer>
  );
}
