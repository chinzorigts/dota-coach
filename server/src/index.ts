import { config } from "./config.js";
import { Advisor, makeClaudeCaller } from "./ai/advisor.js";
import { CoachState } from "./state.js";
import { createApp } from "./app.js";
import { SettingsStore } from "./settings.js";

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
  call: makeClaudeCaller(() => ({
    model: settings.get().ai.model,
    effort: settings.get().ai.effort,
    apiKey: settings.resolvedKey(),
  })),
});
const state = new CoachState(advisor, undefined, undefined, settings);
const { server } = createApp(state, advisor);

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
