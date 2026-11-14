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
  console.log(`\n  Dota Coach 서버 실행 중 → ${url}`);
  console.log(`  GSI 수신: ${url}/gsi  (token: ${config.gsiToken === "dota-coach-local" ? "기본값" : "사용자 지정"})`);
  console.log(
    config.aiEnabled
      ? `  AI 조언: 켜짐 (${config.model}, effort=${config.effort}, 자동 최소 간격 ${config.aiMinIntervalSec}s)`
      : "  AI 조언: 꺼짐 — .env 에 ANTHROPIC_API_KEY 를 넣으면 켜집니다 (규칙 엔진은 그대로 동작)",
  );
  console.log("");
});
