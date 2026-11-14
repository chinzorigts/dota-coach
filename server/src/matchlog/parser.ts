// Parser for Dota 2's game/dota/server_log.txt lobby lines.
//
// IMPORTANT: Valve stopped writing this file in the hotfix of 15 June 2022
// (ValveSoftware/Dota2-Gameplay issue #897: "we won't write anything to server_log.txt anymore").
// On a current client the file is simply never created, so everything built on this parser stays idle.
// It is kept so the feature lights up again if the file ever comes back, and for clients/branches that still write it.
//
// The formats below are the ones documented by community tools before June 2022. They were NOT captured on
// this PC (no server_log.txt exists here), so treat them as best-known shapes, not verified ground truth.

/** Matchmaking through Steam Datagram Relay: the server is a game-server Steam ID, not an IP. */
export const SAMPLE_LOBBY_LINE_SDR =
  "06/10/2022 - 21:15:42: =[A:1:2583351297:19223] (Lobby 27612345678901234 DOTA_GAMEMODE_ALL_DRAFT " +
  "0:[U:1:100000001] 1:[U:1:100000002] 2:[U:1:100000003] 3:[U:1:100000004] 4:[U:1:100000005] " +
  "5:[U:1:100000006] 6:[U:1:100000007] 7:[U:1:100000008] 8:[U:1:100000009] 9:[U:1:100000010]) " +
  "(Party 26432118833381234 0:[U:1:100000001] 1:[U:1:100000002])";

/** Older lines (before SDR) carried the server's IP:port. */
export const SAMPLE_LOBBY_LINE_IP =
  "03/09/2019 - 21:12:14: 155.133.246.35:27031 (Lobby 26180233221324870 DOTA_GAMEMODE_AP " +
  "0:[U:1:200000001] 1:[U:1:200000002] 2:[U:1:200000003] 3:[U:1:200000004] 4:[U:1:200000005] " +
  "5:[U:1:200000006] 6:[U:1:200000007] 7:[U:1:200000008] 8:[U:1:200000009] 9:[U:1:200000010])";

/** Local games (bots, demo hero, custom lobbies hosted on this PC). Carries nothing useful. */
export const SAMPLE_LOOPBACK_LINE = "04/15/2017 - 23:41:24: loopback";

export type ServerRef =
  | { kind: "sdr"; steamId: string }
  | { kind: "ip"; address: string }
  | { kind: "unknown"; raw: string };

export type TeamSide = "radiant" | "dire";

export interface LobbyPlayer {
  slot: number;
  /** 32-bit Steam account ID (what OpenDota calls account_id) */
  accountId: number;
  /** Slots 0-4 are Radiant and 5-9 Dire in matchmaking lobbies; higher slots (coaches etc.) have no side */
  team: TeamSide | null;
}

export interface LobbyInfo {
  /** Timestamp as written in the log, local time of this PC (ms since epoch), or null if unparseable */
  at: number | null;
  server: ServerRef;
  lobbyId: string;
  gameMode: string;
  players: LobbyPlayer[];
  /** Each party is a list of account IDs queued together */
  parties: number[][];
}

const LINE_RE = /^(\d{2})\/(\d{2})\/(\d{4}) - (\d{2}):(\d{2}):(\d{2}): (.*?)\s*\(Lobby (\d+) (\S+)((?:\s+\d+:\[U:1:\d+\])*)\)(.*)$/;
const MEMBER_RE = /(\d+):\[U:1:(\d+)\]/g;
const PARTY_RE = /\(Party \d+((?:\s+\d+:\[U:1:\d+\])*)\)/g;

function members(s: string): { slot: number; accountId: number }[] {
  return [...s.matchAll(MEMBER_RE)].map((m) => ({ slot: Number(m[1]), accountId: Number(m[2]) }));
}

function server(raw: string): ServerRef {
  const sdr = raw.match(/^=?\[A:1:(\d+):\d+\]$/);
  if (sdr) return { kind: "sdr", steamId: sdr[1] };
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(raw)) return { kind: "ip", address: raw };
  return { kind: "unknown", raw };
}

/** Parses one lobby line. Returns null for anything else (loopback lines, noise, partial writes). */
export function parseLobbyLine(line: string): LobbyInfo | null {
  const m = line.trim().match(LINE_RE);
  if (!m) return null;
  const [, mo, d, y, hh, mm, ss, srv, lobbyId, gameMode, memberStr, rest] = m;
  const players = members(memberStr).map(({ slot, accountId }) => ({
    slot,
    accountId,
    team: slot <= 4 ? ("radiant" as const) : slot <= 9 ? ("dire" as const) : null,
  }));
  if (players.length === 0) return null;
  const at = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)).getTime();
  const parties = [...rest.matchAll(PARTY_RE)].map((p) => members(p[1]).map((x) => x.accountId));
  return { at: Number.isFinite(at) ? at : null, server: server(srv), lobbyId, gameMode, players, parties };
}

/** The most recent lobby in a chunk of log text (the file is append-only, newest last). */
export function parseLatestLobby(text: string): LobbyInfo | null {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const info = parseLobbyLine(lines[i]);
    if (info) return info;
  }
  return null;
}

/** GSI gives SteamID64 ("7656119..."); the log and OpenDota use the 32-bit account ID. */
export function accountIdFromSteamId64(steamId: string | undefined | null): number | null {
  if (!steamId || !/^\d{17}$/.test(steamId)) return null;
  const id = BigInt(steamId) - 76561197960265728n;
  return id > 0n && id < 2n ** 32n ? Number(id) : null;
}
