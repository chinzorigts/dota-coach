# Dota Coach

Dota 2 실시간 코치. 게임이 보내는 상태(GSI)를 받아 **지금 살 아이템, 찍을 스킬, 위험 신호, 맵 타이머**를 보여 주고, Claude 가 상황을 읽어 조언합니다. 두 번째 모니터나 폰 브라우저로 봅니다.

```
Dota 2 ──(GSI, 0.5초마다 POST)──► 로컬 서버 :3001 ──(WebSocket)──► 대시보드 (브라우저/폰)
                                      │
                                      ├─ 규칙 엔진: 아이템 · 스킬 · 경고 · 타이머 (항상, 즉시)
                                      ├─ OpenDota: 이 영웅의 실제 인기 빌드 (24시간 캐시)
                                      └─ Claude: 사망·5분마다·적 조합 변경·질문 시 상황 분석
```

## 안전성 — VAC 걱정 없음

데이터는 **Valve 공식 Game State Integration** 으로만 받습니다. 게임이 설정 파일을 읽고 스스로 보내 주는 방식이라 메모리를 읽거나 게임에 무언가를 주입하지 않습니다.

그 대신 한계가 있습니다: **직접 플레이할 때 GSI 는 내 영웅 정보만 줍니다.** 적 아이템·위치는 오지 않아서, 적 영웅은 화면 아래에서 직접 고릅니다(카운터 아이템과 AI 분석에 반영됩니다).

## 시작하기

Node.js 20.12 이상이 필요합니다.

```bash
npm install
cp .env.example .env        # ANTHROPIC_API_KEY 를 넣으면 AI 조언이 켜집니다 (없어도 규칙 엔진은 동작)
npm run install-cfg         # Dota 2 폴더에 GSI 설정 파일을 넣습니다
npm run build && npm start  # http://127.0.0.1:3001
```

마지막으로 **Steam → Dota 2 → 속성 → 시작 옵션**에 `-gamestateintegration` 을 추가하고 Dota 2 를 재시작합니다. 봇전으로 바로 확인할 수 있습니다.

`install-cfg` 가 설치 폴더를 못 찾으면 경로를 넘기세요:

```bash
npm run install-cfg -- "D:\SteamLibrary\steamapps\common\dota 2 beta"
```

### 게임 없이 화면 보기

```bash
npm start            # 터미널 1
npm run mock         # 터미널 2 — 가짜 게임(저거넛)을 20배속으로 보냄
npm run mock -- --speed 5 --start 900 --hero npc_dota_hero_axe --hero-id 2
```

### 개발

```bash
npm run dev:server   # :3001 (tsx watch)
npm run dev:web      # :5173 (Vite, /api·/ws 는 :3001 로 프록시)
npm test             # 서버 단위·통합 테스트 (vitest)
npm run typecheck
```

### 폰으로 보기

`.env` 에 `HOST=0.0.0.0` 을 두고 같은 와이파이에서 `http://<PC IP>:3001` 을 엽니다.
이때 같은 네트워크의 누구나 대시보드를 보고 **AI 질문(API 비용)** 을 보낼 수 있습니다. GSI 수신은 토큰으로 막혀 있습니다.

## 무엇을 추천하나

| 영역 | 근거 |
|---|---|
| 아이템 | ① TP 없음 같은 기본 규칙 ② Claude 추천 ③ 적 조합 카운터(투명·환영·회복·회피·마법 폭딜·침묵·물리 폭딜·버프) ④ OpenDota 인기 빌드(못 쓰면 주 능력치·역할별 기본 빌드). 이미 가진 부품을 빼고 **남은 골드**를 계산합니다 |
| 스킬 | 궁극기 → 특성(10/15/20/25) → 일반 스킬 우선순위(Claude 가 정해 주면 그 순서, 아니면 슬롯 순). 남은 스킬 포인트를 레벨에서 계산합니다 |
| 경고 | 체력·마나 낮음, 사망·바이백 가능, 스킬 포인트 남음, 골드 쌓임, 후반 바이백 골드 부족, TP 없음, 상태이상 |
| 타이머 | 바운티·파워·지혜 룬, 연꽃, 낮/밤, 캠프 스택(:53), 로샨(GSI 가 줄 때) |

## AI 조언 (Claude)

- 부르는 때: 영웅 확정 직후 · 사망 시(30초 쿨다운) · 5분마다(`COACH_AI_MIN_INTERVAL` 간격 이상) · 적 조합 변경 · **질문하기 버튼**
- 기본 모델은 `claude-opus-5-5`, `effort=low`(게임 중 응답 속도 우선). `.env` 의 `COACH_MODEL` / `COACH_EFFORT` 로 바꿉니다. 비용을 줄이려면 `COACH_MODEL=claude-haiku-5-5`
- 안전 분류기 거절 시 서버 측 자동 대체 모델(`fallbacks: "default"`)을 켜 두었습니다
- 응답은 JSON 스키마로 강제하고, 실제로 없는 아이템 키는 버립니다

## 패치가 바뀌면

- 영웅·아이템·스킬 데이터: `npm update dotaconstants -w server`
- 룬·이벤트 주기: `server/src/engine/timers.ts` 한 곳 (`approx: true` 는 패치마다 바뀌기 쉬운 값)
- 카운터 표: `server/src/engine/counters.ts` — 테스트가 모든 영웅·아이템 키가 실제로 있는지 확인합니다
- 스킬 포인트 없는 레벨: `server/src/engine/skills.ts` 의 `NO_POINT_LEVELS`

## 구조

```
server/src
  gsi/        GSI 원본 타입과 정규화
  data/       dotaconstants(정적) · OpenDota(인기 빌드, 캐시)
  engine/     아이템 · 스킬 · 경고 · 타이머 · 카운터 → CoachReport
  ai/         Claude 프롬프트 · 트리거/쓰로틀 · 호출
  state.ts    매치 상태(적 영웅, 역할, 인기 빌드, AI 결과)
  app.ts      HTTP(/gsi, /api/*) + WebSocket(/ws) + 정적 파일
  tools/      install-cfg · mock-gsi
web/src       React 대시보드
```
