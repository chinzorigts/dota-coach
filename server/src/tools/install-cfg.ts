// Writes the cfg into Dota 2's gamestate_integration folder.
// Usage: npm run install-cfg [-- "<path to dota 2 beta>"]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";

export function buildCfg(uri: string, token: string): string {
  return `"Dota 2 Coach"
{
  "uri"       "${uri}"
  "timeout"   "5.0"
  "buffer"    "0.05"
  "throttle"  "0.1"
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

/** Reads extra library paths from libraryfolders.vdf (game installed on another drive) */
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
    console.error("Could not find the Dota 2 install folder.");
    console.error('  Pass the path, e.g. npm run install-cfg -- "C:\\...\\steamapps\\common\\dota 2 beta", or set DOTA_PATH in .env.\n');
    console.error("Or save the following yourself:");
    console.error("  <dota 2 beta>/game/dota/cfg/gamestate_integration/gamestate_integration_coach.cfg\n");
    console.log(cfg);
    process.exit(1);
  }
  const dir = path.join(dota, "game", "dota", "cfg", "gamestate_integration");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "gamestate_integration_coach.cfg");
  fs.writeFileSync(file, cfg);
  console.log(`✔ Saved: ${file}`);
  console.log(`  → ${uri}`);
  console.log("\nLast step: Steam Library > Dota 2 > Properties > Launch Options, add:");
  console.log("  -gamestateintegration\n");
  console.log("Then (re)start Dota 2 and data will start flowing to the server.");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("install-cfg.ts")) main();
