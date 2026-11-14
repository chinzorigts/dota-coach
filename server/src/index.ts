import { config } from "./config.js";
import { Advisor, makeClaudeCaller } from "./ai/advisor.js";
import { CoachState } from "./state.js";
import { createApp } from "./app.js";
import { SettingsStore } from "./settings.js";
import { ServerLogWatcher } from "./matchlog/watcher.js";

// Settings come from the settings screen (saved in .data/), seeded from .env the first time
const settings = new SettingsStore();

const advisor = new Advisor({
  runtime: () => {
    const ai = settings.get().ai;
    return {
      enabled: ai.enabled && settings.hasCredentials(),
      model: ai.model,
      minIntervalSec: ai.autoIntervalSec,
      triggers: ai.triggers,
    };
  },
  call: makeClaudeCaller((reason) => ({
    // Your typed questions get the main model; everything automatic gets the faster live model
    model: reason === "manual" ? settings.get().ai.model : settings.get().ai.liveModel,
    effort: settings.get().ai.effort,
    apiKey: settings.resolvedKey(),
  })),
});
const state = new CoachState(advisor, undefined, undefined, settings);
const { server } = createApp(state, advisor);

// Dota closed (or a mock run ended): stop showing the last game as if it were live
setInterval(() => {
  if (state.expireIfStale()) console.log("[gsi] no data from Dota for a while; showing the waiting screen");
}, 5_000).unref();

// Lobby players from server_log.txt. Restarts when the path or the toggle changes in settings.
const matchLog = new ServerLogWatcher((lobby) => state.ingestLobby(lobby));
state.matchLogStatus = () => (settings.get().matchInfo.enabled ? matchLog.status : null);
let matchLogKey = "";
const syncMatchLog = () => {
  const m = settings.get().matchInfo;
  const key = m.enabled ? `on:${m.logPath}` : "off";
  if (key === matchLogKey) return;
  matchLogKey = key;
  if (m.enabled) matchLog.start(m.logPath);
  else matchLog.stop();
};
syncMatchLog();
settings.onChange(syncMatchLog);

server.listen(config.port, config.host, () => {
  const url = `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`;
  const ai = settings.get().ai;
  console.log(`\n  Dota Coach server running at ${url}`);
  console.log(`  GSI endpoint: ${url}/gsi  (token: ${config.gsiToken === "dota-coach-local" ? "default" : "custom"})`);
  console.log(
    !settings.hasCredentials()
      ? `  AI advice: no API key yet. Add one at ${url}/#settings (the rule engine works either way)`
      : ai.enabled
        ? `  AI advice: on (${ai.model}, effort=${ai.effort})`
        : "  AI advice: turned off in settings",
  );
  console.log(`  Settings: ${url}/#settings\n`);
});
