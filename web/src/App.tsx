import { useEffect, useState } from "react";
import { useCoach } from "./useCoach";
import { TopBar } from "./components/TopBar";
import { NextStrip } from "./components/NextStrip";
import { HeroPanel } from "./components/HeroPanel";
import { ItemList } from "./components/ItemList";
import { SkillPanel } from "./components/SkillPanel";
import { AiPanel } from "./components/AiPanel";
import { Timers } from "./components/Timers";
import { EnemyPicker } from "./components/EnemyPicker";
import { Waiting } from "./components/Waiting";

export default function App() {
  const { state, connected, serverNow } = useCoach();
  // Re-render every second so 'last GSI received' ages on its own
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const gsiAge = state?.lastGsiAt ? (serverNow() - state.lastGsiAt) / 1000 : Infinity;
  const s = state?.snapshot;
  const r = state?.report;

  return (
    <div className="app">
      <TopBar connected={connected} gsiAge={gsiAge} snapshot={s ?? null} report={r ?? null} />
      {!state || !s?.hero || !r ? (
        <Waiting connected={connected} hasGsi={Boolean(state?.lastGsiAt)} gameState={s?.gameState} />
      ) : (
        <>
          <NextStrip report={r} gold={s.player?.gold ?? 0} names={state.names} />
          <main className="grid">
            <section className="col col-hero">
              <HeroPanel state={state} />
            </section>
            <section className="col col-recs">
              <ItemList items={r.items} gold={s.player?.gold ?? 0} source={state.popularitySource} />
              <SkillPanel snapshot={s} report={r} names={state.names} />
            </section>
            <section className="col col-side">
              <AiPanel ai={state.ai} names={state.names} />
              <Timers timers={r.timers} alerts={r.alerts} />
            </section>
          </main>
          <EnemyPicker enemies={state.enemies} source={state.enemySource} detection={state.detection} rolePref={state.rolePref} role={r.role} />
        </>
      )}
    </div>
  );
}
