// Dota 2 의 gamestate_integration 폴더에 cfg 를 써 넣는다.
// 사용: npm run install-cfg [-- "<dota 2 beta 경로>"]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";

export function buildCfg(uri: string, token: string): string {
  return `"Dota 2 Coach"
{
  "uri"       "${uri}"
  "timeout"   "5.0"
  "buffer"    "0.1"
  "throttle"  "0.5"
  "heartbeat" "30.0"
  "data"
  {
    "provider"      "1"
    "map"           "1"
    "player"        "1"
    "hero"          "1"
    "abilities"     "1"
    "items"         "1"
    "draft"         "1"
    "events"        "1"
    "buildings"     "0"
    "wearables"     "0"
    "minimap"       "0"
    "roshan"        "1"
    "neutralitems"  "1"
  }
  "auth"
  {
    "token" "${token}"
  }
}
`;
}

function steamRoots(): string[] {
  const home = os.homedir();
  return [
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam",
    "D:\\Steam",
    "D:\\SteamLibrary",
    "E:\\SteamLibrary",
    path.join(home, ".steam", "steam"),
    path.join(home, ".local", "share", "Steam"),
    path.join(home, "Library", "Application Support", "Steam"),
  ];
}

/** libraryfolders.vdf 에서 추가 라이브러리 경로를 읽는다 (게임을 다른 드라이브에 깐 경우) */
function libraryFolders(root: string): string[] {
  const vdf = path.join(root, "steamapps", "libraryfolders.vdf");
  if (!fs.existsSync(vdf)) return [];
  const text = fs.readFileSync(vdf, "utf8");
  return [...text.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, "\\"));
}

export function findDota(explicit?: string): string | null {
  const candidates = new Set<string>();
  if (explicit) candidates.add(explicit);
  if (process.env.DOTA_PATH) candidates.add(process.env.DOTA_PATH);
  for (const root of steamRoots()) {
    for (const lib of [root, ...libraryFolders(root)]) {
      candidates.add(path.join(lib, "steamapps", "common", "dota 2 beta"));
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "game", "dota"))) return c;
  }
  return null;
}

function main() {
  const dota = findDota(process.argv[2]);
  const uri = `http://127.0.0.1:${config.port}/gsi`;
  const cfg = buildCfg(uri, config.gsiToken);
  if (!dota) {
    console.error("Dota 2 설치 폴더를 찾지 못했습니다.");
    console.error('  npm run install-cfg -- "C:\\...\\steamapps\\common\\dota 2 beta"  처럼 경로를 넘기거나 .env 에 DOTA_PATH 를 넣으세요.\n');
    console.error("또는 아래 내용을 직접 저장하세요:");
    console.error("  <dota 2 beta>/game/dota/cfg/gamestate_integration/gamestate_integration_coach.cfg\n");
    console.log(cfg);
    process.exit(1);
  }
  const dir = path.join(dota, "game", "dota", "cfg", "gamestate_integration");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "gamestate_integration_coach.cfg");
  fs.writeFileSync(file, cfg);
  console.log(`✔ 저장: ${file}`);
  console.log(`  → ${uri}`);
  console.log("\n마지막 단계: Steam 라이브러리 → Dota 2 → 속성 → 시작 옵션에 다음을 추가하세요");
  console.log("  -gamestateintegration\n");
  console.log("그 다음 Dota 2 를 (재)시작하면 서버로 데이터가 들어옵니다.");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("install-cfg.ts")) main();
