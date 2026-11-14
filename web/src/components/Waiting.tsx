export function Waiting({ connected, hasGsi, gameState }: { connected: boolean; hasGsi: boolean; gameState?: string }) {
  if (!connected) {
    return (
      <div className="waiting">
        <h1>서버에 연결하는 중</h1>
        <p>터미널에서 <code>npm start</code> 가 실행 중인지 확인하세요. 연결되면 자동으로 이어집니다.</p>
      </div>
    );
  }
  if (hasGsi) {
    return (
      <div className="waiting">
        <h1>영웅을 고르면 시작합니다</h1>
        <p>Dota 2 에서 데이터가 들어오고 있습니다{gameState ? ` (${gameState.replace("DOTA_GAMERULES_STATE_", "").toLowerCase()})` : ""}. 영웅이 정해지면 분석이 바로 뜹니다.</p>
      </div>
    );
  }
  return (
    <div className="waiting">
      <h1>Dota 2 를 기다리는 중</h1>
      <ol>
        <li><code>npm run install-cfg</code> 로 게임 폴더에 설정 파일을 넣습니다.</li>
        <li>Steam → Dota 2 → 속성 → 시작 옵션에 <code>-gamestateintegration</code> 을 추가합니다.</li>
        <li>Dota 2 를 재시작하고 게임(봇전도 됩니다)에 들어갑니다.</li>
      </ol>
      <p className="hint">게임 없이 화면만 보려면 다른 터미널에서 <code>npm run mock</code></p>
    </div>
  );
}
