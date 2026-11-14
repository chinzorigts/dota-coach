import { Img } from "../components/Img";
import { heroIcon } from "../format";
import type { MatchInfo, MatchPlayer } from "../types";

/**
 * Enemy players from the lobby (server_log.txt) with their OpenDota rank, recent win rate and most played heroes.
 * Heroes picked this game come from the separate enemy-hero row (GSI / vision / manual), so nothing here
 * guesses which player is on which hero.
 */
export function OpponentsPanel({ match }: { match: MatchInfo }) {
  const sideKnown = match.myTeam !== null;
  return (
    <div className="ov-opp" aria-label="Enemy players">
      <div className="ov-opp-head">
        <strong>{sideKnown ? "Enemy players" : "Dire players"}</strong>
        <small>{match.gameMode.replace(/^DOTA_GAMEMODE_/, "").replace(/_/g, " ").toLowerCase()}</small>
      </div>
      {match.enemies.map((p) => <Row key={p.accountId} p={p} />)}
    </div>
  );
}

function Row({ p }: { p: MatchPlayer }) {
  const s = p.stats;
  const wr = s?.recent.winRate;
  return (
    <div className="ov-opp-row">
      <span className="ov-opp-name" title={s?.name ?? String(p.accountId)}>
        {p.party !== null && <span className="ov-opp-party" title="Queued together">P{p.party + 1}</span>}
        {s?.name ?? `#${p.accountId}`}
      </span>
      {p.status === "loading" ? (
        <small className="ov-opp-muted">loading…</small>
      ) : !s ? (
        <small className="ov-opp-muted">OpenDota unavailable</small>
      ) : s.isPrivate ? (
        <small className="ov-opp-muted">{s.rank ? `${s.rank} · ` : ""}private profile</small>
      ) : (
        <>
          <span className="ov-opp-rank">{s.rank ?? "Unranked"}</span>
          <span className={`ov-opp-wr ${wr !== null && wr !== undefined ? (wr >= 0.6 ? "hot" : wr <= 0.4 ? "cold" : "") : ""}`}
            title={`${s.recent.wins}W ${s.recent.losses}L in the last ${s.recent.games}`}>
            {wr === null || wr === undefined ? "–" : `${Math.round(wr * 100)}%`}
          </span>
          <span className="ov-opp-heroes">
            {s.topHeroes.filter((h) => h.name).map((h) => (
              <Img key={h.heroId} src={heroIcon(h.name!)} label={`${h.name!.replace("npc_dota_hero_", "")}: ${h.games} games`} width={18} height={18} />
            ))}
          </span>
        </>
      )}
    </div>
  );
}
