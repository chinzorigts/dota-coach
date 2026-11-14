// Watches game/dota/server_log.txt for new lobby lines.
// See parser.ts: current Dota clients no longer write this file, so on most PCs the watcher just reports
// "file not found" and stays idle. Polling (fs.watchFile) is used because it survives the file being created
// later, truncated or replaced, and behaves the same on Windows network/Steam library drives.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseLatestLobby, type LobbyInfo } from "./parser.js";

const DOTA_REL = path.join("steamapps", "common", "dota 2 beta", "game", "dota");
const TAIL_BYTES = 64 * 1024;

function steamRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = os.homedir();
  return [
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Steam"),
    env.ProgramFiles && path.join(env.ProgramFiles, "Steam"),
    "C:\\Program Files (x86)\\Steam",
    path.join(home, ".steam", "steam"),
    path.join(home, ".local", "share", "Steam"),
    path.join(home, "Library", "Application Support", "Steam"),
  ].filter((p): p is string => Boolean(p));
}

/** Library folders listed in steamapps/libraryfolders.vdf ("path" "D:\\SteamLibrary") */
export function parseLibraryFolders(vdf: string): string[] {
  return [...vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\\\/g, "\\"));
}

/** Every place server_log.txt could live, best guesses first */
export function candidateLogPaths(roots = steamRoots(), readFile = (p: string) => fs.readFileSync(p, "utf8")): string[] {
  const libs: string[] = [];
  for (const root of roots) {
    libs.push(root);
    try {
      libs.push(...parseLibraryFolders(readFile(path.join(root, "steamapps", "libraryfolders.vdf"))));
    } catch {
      /* no Steam here */
    }
  }
  const seen = new Set<string>();
  return libs
    .map((lib) => path.join(lib, DOTA_REL, "server_log.txt"))
    .filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
}

/**
 * The configured path, or the first existing server_log.txt, or (if none exists yet) the one inside the
 * first Dota install found so the watcher picks it up if the game creates it. Null when Dota isn't found.
 */
export function resolveLogPath(configured: string, exists = fs.existsSync): string | null {
  if (configured.trim()) return configured.trim();
  const candidates = candidateLogPaths();
  return candidates.find((p) => exists(p)) ?? candidates.find((p) => exists(path.dirname(p))) ?? null;
}

export interface WatcherStatus {
  path: string | null;
  exists: boolean;
  lastLobbyAt: number | null;
  error: string | null;
}

export class ServerLogWatcher {
  private file: string | null = null;
  private lastLobbyId: string | null = null;
  status: WatcherStatus = { path: null, exists: false, lastLobbyAt: null, error: null };

  constructor(private onLobby: (lobby: LobbyInfo) => void, private intervalMs = 1500) {}

  /** (Re)starts watching. Pass "" for auto-detect. Re-reads the current file once, so a lobby written before the server started still counts. */
  start(configuredPath: string) {
    this.stop();
    this.file = resolveLogPath(configuredPath);
    this.status = { path: this.file, exists: false, lastLobbyAt: null, error: this.file ? null : "Dota 2 install not found" };
    if (!this.file) return;
    this.check();
    fs.watchFile(this.file, { interval: this.intervalMs, persistent: false }, () => this.check());
  }

  stop() {
    if (this.file) fs.unwatchFile(this.file);
    this.file = null;
    this.status = { path: null, exists: false, lastLobbyAt: null, error: null };
  }

  private check() {
    const file = this.file;
    if (!file) return;
    try {
      const { size } = fs.statSync(file);
      const fd = fs.openSync(file, "r");
      try {
        const len = Math.min(size, TAIL_BYTES);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, size - len);
        this.status.exists = true;
        this.status.error = null;
        const lobby = parseLatestLobby(buf.toString("utf8"));
        if (lobby && lobby.lobbyId !== this.lastLobbyId) {
          this.lastLobbyId = lobby.lobbyId;
          this.status.lastLobbyAt = lobby.at;
          this.onLobby(lobby);
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      this.status.exists = false;
      this.status.error = e.code === "ENOENT" ? "server_log.txt not found (current Dota clients no longer write it)" : e.message;
    }
  }
}
