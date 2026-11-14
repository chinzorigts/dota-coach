import { config } from "./config.js";
import { Advisor, makeClaudeCaller } from "./ai/advisor.js";
import { CoachState } from "./state.js";
import { createApp } from "./app.js";

const advisor = new Advisor({
  enabled: config.aiEnabled,
  model: config.model,
  minIntervalSec: config.aiMinIntervalSec,
  call: config.aiEnabled ? makeClaudeCaller(config.model, config.effort) : null,
});
const state = new CoachState(advisor);
const { server } = createApp(state, advisor);

server.listen(config.port, config.host, () => {
  const url = `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`;
  console.log(`\n  Dota Coach server running at ${url}`);
  console.log(`  GSI endpoint: ${url}/gsi  (token: ${config.gsiToken === "dota-coach-local" ? "default" : "custom"})`);
  console.log(
    config.aiEnabled
      ? `  AI advice: on (${config.model}, effort=${config.effort}, min auto interval ${config.aiMinIntervalSec}s)`
      : "  AI advice: off. Add ANTHROPIC_API_KEY to .env to enable it (the rule engine works either way)",
  );
  console.log("");
});
