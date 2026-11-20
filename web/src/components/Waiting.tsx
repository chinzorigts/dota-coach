import { useT } from "../i18n";

export function Waiting({ connected, hasGsi, gameState }: { connected: boolean; hasGsi: boolean; gameState?: string }) {
  const t = useT();
  if (!connected) {
    return (
      <div className="waiting">
        <h1>{t.connectingTitle}</h1>
        <p>{t.connectingBefore}<code>npm start</code>{t.connectingAfter}</p>
      </div>
    );
  }
  if (hasGsi) {
    return (
      <div className="waiting">
        <h1>{t.pickHeroTitle}</h1>
        <p>{t.gsiSending(gameState ? gameState.replace("DOTA_GAMERULES_STATE_", "").toLowerCase() : "")}</p>
      </div>
    );
  }
  return (
    <div className="waiting">
      <h1>{t.waitingDotaTitle}</h1>
      <ol>
        <li>{t.step1Before}<code>npm run install-cfg</code>{t.step1After}</li>
        <li>{t.step2Before}<code>-gamestateintegration</code>{t.step2After}</li>
        <li>{t.step3}</li>
      </ol>
      <p className="hint">{t.mockBefore}<code>npm run mock</code>{t.mockAfter}</p>
    </div>
  );
}
