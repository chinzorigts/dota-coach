export function Waiting({ connected, hasGsi, gameState }: { connected: boolean; hasGsi: boolean; gameState?: string }) {
  if (!connected) {
    return (
      <div className="waiting">
        <h1>Connecting to the server</h1>
        <p>Check that <code>npm start</code> is running in a terminal. This page reconnects on its own.</p>
      </div>
    );
  }
  if (hasGsi) {
    return (
      <div className="waiting">
        <h1>Pick a hero to start</h1>
        <p>Dota 2 is sending data{gameState ? ` (${gameState.replace("DOTA_GAMERULES_STATE_", "").toLowerCase()})` : ""}. Analysis appears as soon as your hero is locked in.</p>
      </div>
    );
  }
  return (
    <div className="waiting">
      <h1>Waiting for Dota 2</h1>
      <ol>
        <li>Run <code>npm run install-cfg</code> to put the config file in your game folder.</li>
        <li>In Steam, open Dota 2 &gt; Properties &gt; Launch Options and add <code>-gamestateintegration</code>.</li>
        <li>Restart Dota 2 and join a game (a bot match works).</li>
      </ol>
      <p className="hint">To preview without a game, run <code>npm run mock</code> in another terminal.</p>
    </div>
  );
}
