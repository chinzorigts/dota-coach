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
import { Settings } from "./components/Settings";
import { StatsCompare } from "./components/StatsCompare";
import { RankCard } from "./components/RankCard";
import { DraftPanel } from "./components/DraftPanel";
import { NeutralCard } from "./components/NeutralCard";

/** #settings opens the settings screen; plain hash routing keeps it linkable from the server log */
function useHashRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export default function App() {
  const { state, connected, serverNow } = useCoach();
  const route = useHashRoute();
  const inSettings = route === "#settings";
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
      <TopBar connected={connected} gsiAge={gsiAge} snapshot={s ?? null} report={r ?? null}
        inSettings={inSettings} noKey={state?.apiKey.source === "none"} />
      {inSettings ? (
        <Settings onClose={() => (location.hash = "")} />
      ) : !state || !s?.hero || !r ? (
        <>
          {/* Dota sends at least every 30s while running; older data means it isn't running now */}
          <Waiting connected={connected} hasGsi={gsiAge < 75} gameState={s?.gameState} />
          {state && (
            <main className="grid pregame">
              {state.draft && <section className="col"><DraftPanel draft={state.draft} /></section>}
              <section className="col"><RankCard rank={state.rank} /></section>
            </main>
          )}
        </>
      ) : (
        <>
          <NextStrip report={r} gold={s.player?.gold ?? 0} names={state.names} />
          <main className="grid">
            <section className="col col-hero">
              <HeroPanel state={state} />
              {state.benchmark && <StatsCompare b={state.benchmark} />}
            </section>
            <section className="col col-recs">
              <ItemList items={r.items} gold={s.player?.gold ?? 0} source={state.popularitySource}
                purchases={state.purchases} names={state.names.items} />
              <SkillPanel snapshot={s} report={r} names={state.names} />
              {r.neutral && <NeutralCard n={r.neutral} aiOn={state.ai.enabled} />}
            </section>
            <section className="col col-side">
              <AiPanel ai={state.ai} names={state.names} clockNow={s.clockTime} />
              <Timers timers={r.timers} alerts={r.alerts} />
              <RankCard rank={state.rank} />
            </section>
          </main>
          <EnemyPicker enemies={state.enemies} source={state.enemySource} detection={state.detection} rolePref={state.rolePref} role={r.role} />
        </>
      )}
    </div>
  );
}
