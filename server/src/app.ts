import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { allHeroes } from "./data/constants.js";
import type { CoachState } from "./state.js";
import { testConnection, type Advisor } from "./ai/advisor.js";
import { EFFORTS, MODELS, OVERLAY_SECTIONS, TIMER_IDS } from "./settings.js";
import type { RawGsi } from "./gsi/types.js";
import { makeImage, type RGBImage } from "./vision/image.js";

const MAX_SLOT_PX = 128;

/**
 * Settings can change the API key and what gets billed, so only requests from this PC may edit them.
 * With HOST=0.0.0.0 a phone on the same Wi-Fi can still read the dashboard and settings.
 */
function isLocal(req: http.IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

/** Validates the overlay's capture payload: { w, h, radiant: base64 RGB[], dire: base64 RGB[] } */
function parseFrames(body: any): { radiant: RGBImage[]; dire: RGBImage[] } | string {
  const w = Number(body?.w), h = Number(body?.h);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 8 || h < 8 || w > MAX_SLOT_PX || h > MAX_SLOT_PX) {
    return `w and h must be integers between 8 and ${MAX_SLOT_PX}`;
  }
  const side = (list: unknown): RGBImage[] | string => {
    if (!Array.isArray(list) || list.length !== 5) return "each side needs exactly 5 slots";
    const out: RGBImage[] = [];
    for (const b64 of list) {
      if (typeof b64 !== "string") return "slots must be base64 strings";
      const buf = Buffer.from(b64, "base64");
      if (buf.length !== w * h * 3) return `each slot must be ${w}x${h} RGB (${w * h * 3} bytes)`;
      out.push(makeImage(w, h, new Uint8Array(buf)));
    }
    return out;
  };
  const radiant = side(body.radiant);
  if (typeof radiant === "string") return radiant;
  const dire = side(body.dire);
  if (typeof dire === "string") return dire;
  return { radiant, dire };
}

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
    return res.end("The web UI is not built. Run `npm run build` and reload, or open http://localhost:5173 during development.");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

export function createApp(
  state: CoachState,
  advisor: Advisor,
  gsiToken = config.gsiToken,
  deps: { testAi: typeof testConnection } = { testAi: testConnection },
) {
  const settings = state.settings;
  const settingsView = (req: http.IncomingMessage) => ({
    settings: settings.get(),
    apiKey: settings.keyStatus(),
    canEdit: isLocal(req),
    options: { models: MODELS, efforts: EFFORTS, timers: TIMER_IDS, overlaySections: OVERLAY_SECTIONS },
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      // Dota 2 POSTs here roughly every 0.5s
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
        if (!Array.isArray(body.heroes)) return json(res, 400, { error: "heroes must be an array" });
        state.setEnemies(body.heroes.map(String));
        return json(res, 200, { enemies: state.enemies });
      }

      // Overlay asks whether it should keep capturing the top bar
      if (url.pathname === "/api/vision/status") {
        return json(res, 200, { wanted: state.visionWanted(), ...state.detection });
      }

      if (req.method === "POST" && url.pathname === "/api/vision/topbar") {
        const frames = parseFrames(JSON.parse((await readBody(req, 200_000)) || "{}"));
        if (typeof frames === "string") return json(res, 400, { error: frames });
        const status = await state.ingestVision(frames);
        return json(res, 200, { wanted: state.visionWanted(), enemies: state.enemies, ...status });
      }

      if (url.pathname.startsWith("/api/settings")) {
        if (req.method === "GET" && url.pathname === "/api/settings") return json(res, 200, settingsView(req));
        if (!isLocal(req)) return json(res, 403, { error: "Settings can only be changed on the PC running Dota Coach" });

        if (req.method === "PATCH" && url.pathname === "/api/settings") {
          settings.update(JSON.parse((await readBody(req, 20_000)) || "{}"));
          return json(res, 200, settingsView(req));
        }
        if (req.method === "POST" && url.pathname === "/api/settings/reset") {
          settings.reset();
          return json(res, 200, settingsView(req));
        }
        if (url.pathname === "/api/settings/api-key") {
          if (req.method === "DELETE") {
            settings.setApiKey(null);
            return json(res, 200, settingsView(req));
          }
          if (req.method === "PUT") {
            const key = String(JSON.parse((await readBody(req, 2_000)) || "{}").key ?? "").trim();
            if (key.length < 20 || key.length > 300 || /\s/.test(key)) {
              return json(res, 400, { error: "That doesn't look like an API key" });
            }
            settings.setApiKey(key);
            return json(res, 200, settingsView(req));
          }
        }
        if (req.method === "POST" && url.pathname === "/api/settings/test-ai") {
          if (!settings.hasCredentials()) return json(res, 200, { ok: false, error: "No API key set" });
          return json(res, 200, await deps.testAi(settings.get().ai.model, settings.resolvedKey()));
        }
        return json(res, 404, { error: "not found" });
      }

      if (req.method === "POST" && url.pathname === "/api/rank/undo") {
        if (!isLocal(req)) return json(res, 403, { error: "Only on the PC running Dota Coach" });
        return json(res, 200, { undone: state.undoLastRankChange(), rank: state.rank() });
      }

      if (req.method === "POST" && url.pathname === "/api/role") {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!["auto", "core", "support"].includes(body.role)) return json(res, 400, { error: "role must be auto|core|support" });
        state.setRole(body.role);
        return json(res, 200, { role: state.rolePref });
      }

      if (req.method === "POST" && url.pathname === "/api/ask") {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!state.snapshot || !state.report) return json(res, 409, { error: "No game data yet" });
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

  // GSI can burst every 0.1s; push to browsers at most 4 times per second
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
