import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { allHeroes } from "./data/constants.js";
import type { CoachState } from "./state.js";
import type { Advisor } from "./ai/advisor.js";
import type { RawGsi } from "./gsi/types.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function readBody(req: http.IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function serveStatic(res: http.ServerResponse, urlPath: string) {
  const root = config.webDist;
  const safe = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  let file = path.join(root, safe);
  if (!file.startsWith(root)) return json(res, 403, { error: "forbidden" });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end("웹 UI 가 빌드되지 않았습니다. `npm run build` 후 다시 열거나, 개발 중이면 http://localhost:5173 을 여세요.");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

export function createApp(state: CoachState, advisor: Advisor, gsiToken = config.gsiToken) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      // Dota 2 → 여기로 매 0.5초 정도마다 POST
      if (req.method === "POST" && url.pathname === "/gsi") {
        const raw = JSON.parse(await readBody(req)) as RawGsi;
        if (raw.auth?.token !== gsiToken) return json(res, 401, { error: "bad gsi token" });
        state.ingest(raw);
        res.writeHead(200);
        return res.end();
      }

      if (url.pathname === "/api/health") return json(res, 200, { ok: true });
      if (url.pathname === "/api/state") return json(res, 200, state);
      if (url.pathname === "/api/heroes") {
        return json(
          res,
          200,
          allHeroes().map((h) => ({ name: h.name, localizedName: h.localizedName, icon: h.icon, img: h.img, roles: h.roles })),
        );
      }

      if (req.method === "POST" && url.pathname === "/api/enemies") {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!Array.isArray(body.heroes)) return json(res, 400, { error: "heroes 배열이 필요합니다" });
        state.setEnemies(body.heroes.map(String));
        return json(res, 200, { enemies: state.enemies });
      }

      if (req.method === "POST" && url.pathname === "/api/role") {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!["auto", "core", "support"].includes(body.role)) return json(res, 400, { error: "role 은 auto|core|support" });
        state.setRole(body.role);
        return json(res, 200, { role: state.rolePref });
      }

      if (req.method === "POST" && url.pathname === "/api/ask") {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!state.snapshot || !state.report) return json(res, 409, { error: "아직 게임 데이터가 없습니다" });
        const question = typeof body.question === "string" ? body.question.slice(0, 500) : undefined;
        try {
          await advisor.ask(state.snapshot, state.report, state.enemies, question);
        } catch (err) {
          return json(res, 409, { error: (err as Error).message });
        }
        return json(res, 200, advisor.status());
      }

      if (req.method === "GET" && !url.pathname.startsWith("/api/")) return serveStatic(res, url.pathname);
      return json(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof SyntaxError) return json(res, 400, { error: "invalid json" });
      console.error(err);
      return json(res, 500, { error: "internal error" });
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  const send = (ws: WebSocket) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "state", data: state }));
  wss.on("connection", (ws) => send(ws));

  // GSI 가 0.1초 간격으로 몰려 와도 브라우저에는 최대 4번/초만 보낸다
  let scheduled = false;
  state.onChange(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      for (const ws of wss.clients) send(ws);
    }, 250);
  });

  return { server, wss };
}
