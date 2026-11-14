// 실제 게임 없이 대시보드를 확인하기 위한 가짜 GSI 송신기.
// 사용: npm run mock [-- --speed 30 --hero npc_dota_hero_juggernaut]
import { config } from "../config.js";
import { getHeroAbilities, getAbility } from "../data/constants.js";
import type { RawGsi } from "../gsi/types.js";

const args = process.argv.slice(2);
const arg = (name: string, d: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const speed = Number(arg("speed", "20")); // 실제 1초 = 게임 N초
const heroName = arg("hero", "npc_dota_hero_juggernaut");
const heroId = Number(arg("hero-id", "8"));
const target = arg("url", `http://127.0.0.1:${config.port}/gsi`);

const abilities = (getHeroAbilities(heroName)?.abilities ?? []).filter(
  (a) => !a.startsWith("generic_hidden") && !getAbility(a).innate,
);
const ultIndex = abilities.length - 1;

// 시간순으로 구매할 아이템 (게임 초, 키)
const PURCHASES: [number, string][] = [
  [-80, "tango"], [-80, "quelling_blade"], [-80, "branches"], [-80, "branches"],
  [240, "magic_wand"], [420, "boots"], [600, "power_treads"],
  [900, "mjollnir"], [1500, "black_king_bar"], [2100, "manta"],
];
// 이 시각들에 죽는다
const DEATHS = [540, 1260, 1980];

function stateAt(clock: number): RawGsi {
  const level = Math.max(1, Math.min(25, Math.floor(1 + Math.sqrt(Math.max(0, clock)) / 2.2)));
  // 일부러 스킬 포인트 하나를 남겨 둬서 "스킬 찍기" 경고를 볼 수 있게 한다
  let points = Math.max(0, level - 1);
  const levels = abilities.map(() => 0);
  const ultCap = level >= 18 ? 3 : level >= 12 ? 2 : level >= 6 ? 1 : 0;
  let guard = 0;
  while (points > 0 && guard++ < 100) {
    if (ultIndex >= 0 && levels[ultIndex] < ultCap) { levels[ultIndex]++; points--; continue; }
    const i = levels.findIndex((l, idx) => idx !== ultIndex && l < Math.min(4, Math.ceil(level / 2)));
    if (i < 0) break;
    levels[i]++;
    points--;
  }

  const owned = PURCHASES.filter(([t]) => clock >= t).map(([, k]) => k);
  // 상위 아이템을 사면 부품은 사라진다 — 단순화를 위해 신발만 정리
  const STARTERS = ["tango", "branches", "quelling_blade"];
  const inv = owned.filter(
    (k) => !(k === "boots" && owned.includes("power_treads")) && !(clock > 600 && STARTERS.includes(k)),
  );
  const deaths = DEATHS.filter((t) => clock >= t).length;
  const deadFor = DEATHS.map((t) => clock - t).find((d) => d >= 0 && d < 30);
  const minutes = Math.max(clock, 1) / 60;
  const hpWave = 0.55 + 0.45 * Math.sin(clock / 37);

  const items: RawGsi["items"] = {};
  for (let i = 0; i < 9; i++) items[`slot${i}`] = { name: inv[i] ? `item_${inv[i]}` : "empty" };
  for (let i = 0; i < 6; i++) items[`stash${i}`] = { name: "empty" };
  // 15분 이후엔 TP 를 깜빡한 상황
  items["teleport0"] = { name: clock < 900 ? "item_tpscroll" : "empty", charges: 1 };
  items["neutral0"] = { name: "empty" };

  const maxHealth = 600 + level * 85;
  return {
    auth: { token: config.gsiToken },
    provider: { name: "Dota 2", appid: 570, version: 47, timestamp: Math.floor(Date.now() / 1000) },
    map: {
      name: "start",
      matchid: "8000000001",
      game_time: clock + 90,
      clock_time: Math.floor(clock),
      daytime: Math.floor(Math.max(0, clock) / 300) % 2 === 0,
      radiant_score: Math.floor(minutes * 0.9),
      dire_score: Math.floor(minutes * 0.8),
      game_state: clock < 0 ? "DOTA_GAMERULES_STATE_PRE_GAME" : "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS",
      paused: false,
    },
    player: {
      name: "MockPlayer",
      team_name: "radiant",
      kills: Math.floor(minutes / 4),
      deaths,
      assists: Math.floor(minutes / 3),
      last_hits: Math.floor(Math.max(0, minutes) * 6.2),
      denies: Math.floor(Math.max(0, minutes) * 0.8),
      gold: Math.floor(600 + ((clock * 37) % 2600)),
      gold_reliable: 400,
      gold_unreliable: 600,
      gpm: Math.floor(450 + minutes * 4),
      xpm: Math.floor(500 + minutes * 3),
    },
    hero: {
      id: heroId,
      name: heroName,
      level,
      alive: deadFor === undefined,
      respawn_seconds: deadFor === undefined ? 0 : Math.max(0, 30 - Math.floor(deadFor)),
      buyback_cost: Math.floor(200 + clock / 4),
      buyback_cooldown: 0,
      health: deadFor === undefined ? Math.floor(maxHealth * hpWave) : 0,
      max_health: maxHealth,
      health_percent: deadFor === undefined ? Math.floor(hpWave * 100) : 0,
      mana: 300,
      max_mana: 400 + level * 20,
      mana_percent: 70,
      attributes_level: 0,
      aghanims_scepter: false,
      aghanims_shard: false,
      ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`talent_${i}`, false])),
    },
    abilities: Object.fromEntries(
      abilities.map((name, i) => [
        `ability${i}`,
        { name, level: levels[i], can_cast: levels[i] > 0, passive: false, ability_active: true, cooldown: 0, ultimate: i === ultIndex },
      ]),
    ),
    items,
  };
}

let clock = Number(arg("start", "-90"));
console.log(`가짜 게임 송신 → ${target} (${heroName}, x${speed} 속도). Ctrl+C 로 종료`);
setInterval(async () => {
  clock += speed * 0.5;
  try {
    const res = await fetch(target, { method: "POST", body: JSON.stringify(stateAt(clock)) });
    if (!res.ok) console.error(`서버 응답 ${res.status}`);
  } catch {
    console.error("서버에 연결할 수 없습니다 — npm run dev:server 가 켜져 있나요?");
  }
  if (Math.floor(clock) % 60 === 0) process.stdout.write(`\r게임 시계 ${Math.floor(clock / 60)}분   `);
}, 500);

