// @ts-check
// Dota Coach overlay: a transparent, always-on-top, click-through window that shows /overlay over the game.
//
// Dota 2 must run in "Borderless window" mode. In exclusive fullscreen the game owns the screen and no
// other window can be drawn on top of it (true for every external overlay, not just this one).
//
// The overlay only displays what the local server already has from GSI. It never touches the game process.

const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Menu, Tray, nativeImage, screen, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  /* no .env */
}

const PORT = Number(process.env.PORT ?? 3001);
const BASE = `http://127.0.0.1:${PORT}`;

const HOTKEYS = {
  toggle: "CommandOrControl+Shift+H",
  lock: "CommandOrControl+Shift+L",
  ask: "CommandOrControl+Shift+Q",
};
/** Labels shown in the overlay UI */
const HOTKEY_LABELS = {
  toggle: process.platform === "darwin" ? "⌘⇧H" : "Ctrl+Shift+H",
  lock: process.platform === "darwin" ? "⌘⇧L" : "Ctrl+Shift+L",
  ask: process.platform === "darwin" ? "⌘⇧Q" : "Ctrl+Shift+Q",
};

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
/** @type {import("node:child_process").ChildProcess | null} */
let serverProc = null;
let locked = true;
/** Grab-handle state: the watchdog interval and whether a window drag is in progress */
/** @type {ReturnType<typeof setInterval> | undefined} */
let gripWatch;
let dragging = false;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let dragEnd;

// ── persisted window bounds ──────────────────────────────────────────────────
const settingsFile = () => path.join(app.getPath("userData"), "overlay.json");

/**
 * @typedef {{ x: number; y: number; w: number; h: number }} Rect01  fractions of the screen
 * @typedef {{ radiant: Rect01; dire: Rect01; displayId: number }} Calibration
 * @typedef {{ bounds?: Electron.Rectangle; calibration?: Calibration; autostart?: boolean }} Settings
 */

/** @returns {Settings} */
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}

/** Merge into the settings file (position and calibration are saved at different times) @param {Settings} patch */
function saveSettings(patch) {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...loadSettings(), ...patch }));
  } catch (err) {
    console.warn("[overlay] could not save settings:", err);
  }
}

/** @param {Electron.Rectangle} bounds */
const saveBounds = (bounds) => saveSettings({ bounds });

/** Default spot: right edge, a little below the top, clear of Dota's top bar and minimap */
function defaultBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = 340;
  const height = 300;
  return { x: area.x + area.width - width - 16, y: area.y + 120, width, height };
}

/**
 * One-click spots, picked to stay clear of Dota's HUD: the top bar (centre top), minimap (bottom left) and
 * the hero/item panel (bottom centre/right). Keeps the current size and display.
 * @param {"top-right" | "top-left" | "right" | "left"} spot
 */
function moveTo(spot) {
  if (!win) return;
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const { width, height } = win.getBounds();
  const m = 16;
  const top = area.y + Math.round(area.height * 0.08); // below the top bar's clock/score row
  const mid = area.y + Math.round((area.height - height) * 0.42);
  const pos = {
    "top-right": { x: area.x + area.width - width - m, y: top },
    "top-left": { x: area.x + m, y: top },
    right: { x: area.x + area.width - width - m, y: mid },
    left: { x: area.x + m, y: mid },
  }[spot];
  win.setBounds({ ...pos, width, height });
  saveBounds(win.getBounds());
}

/** Same spot on the next monitor (relative position kept) */
function moveToNextDisplay() {
  if (!win) return;
  const displays = screen.getAllDisplays();
  if (displays.length < 2) return;
  const b = win.getBounds();
  const cur = screen.getDisplayMatching(b);
  const next = displays[(displays.findIndex((d) => d.id === cur.id) + 1) % displays.length];
  const fx = (b.x - cur.workArea.x) / cur.workArea.width;
  const fy = (b.y - cur.workArea.y) / cur.workArea.height;
  const a = next.workArea;
  win.setBounds({
    x: Math.round(a.x + Math.min(fx * a.width, a.width - b.width)),
    y: Math.round(a.y + Math.min(fy * a.height, a.height - b.height)),
    width: b.width,
    height: b.height,
  });
  saveBounds(win.getBounds());
}

/** Saved bounds only count if they are still on a connected display (monitors change) */
function initialBounds() {
  const saved = loadSettings().bounds;
  if (!saved) return defaultBounds();
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y;
  });
  return visible ? saved : defaultBounds();
}

// ── local server ──────────────────────────────────────────────────────────────
async function serverUp() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

let quitting = false;
let starting = false;

// ── stay out of the game's way ────────────────────────────────────────────────
// Every coach process runs at below-normal CPU priority, so when Dota needs the CPU it always wins.
// The coach only reacts to GSI updates a couple of times a second, so it never notices the difference.
const BELOW_NORMAL = os.constants.priority.PRIORITY_BELOW_NORMAL;
/** @type {Set<number>} */
const lowered = new Set();
/** @param {number} pid */
function lowerPriority(pid) {
  if (lowered.has(pid)) return;
  try {
    os.setPriority(pid, BELOW_NORMAL);
    lowered.add(pid);
  } catch {
    /* process already gone */
  }
}
/** Electron's own helper processes (GPU, renderer, network) appear after startup; catch them as they do */
function lowerAppPriority() {
  for (const m of app.getAppMetrics()) lowerPriority(m.pid);
}

/** Server stdout/stderr go here. Trimmed to the last ~1 MB on each start so it can't grow forever. */
function serverLogFile() {
  const file = path.join(app.getPath("userData"), "server.log");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size > 2 * 1024 * 1024) {
      const buf = fs.readFileSync(file);
      fs.writeFileSync(file, buf.subarray(buf.length - 1024 * 1024));
    }
  } catch {
    /* logging is best effort */
  }
  return file;
}

/** Start the coach server if nobody else has. Uses the system `node` (the one that ran npm install). */
async function ensureServer() {
  if (starting || quitting) return;
  if (await serverUp()) return;
  starting = true;
  try {
    console.log(`[overlay] starting the coach server… (log: ${serverLogFile()})`);
    // The server runs without a console window and writes to a log file, so the overlay can be started
    // with no terminal at all (and a stray Ctrl+C in some terminal can't take the server down).
    const log = fs.openSync(serverLogFile(), "a");
    fs.writeSync(log, `\n==== ${new Date().toISOString()} server start ====\n`);
    // Prefer the prebuilt bundle (plain node, no TypeScript compiler loaded at runtime: faster start, less
    // memory). Fall back to tsx when it hasn't been built, e.g. `npm start -w overlay` on a fresh clone.
    const bundle = path.join(ROOT, "server", "dist", "index.js");
    const args = fs.existsSync(bundle) ? [bundle] : ["--import", "tsx", "server/src/index.ts"];
    // No shell: node.exe is found on PATH directly, and Node warns (DEP0190) about args passed through a shell
    const proc = spawn("node", args, {
      cwd: ROOT,
      stdio: ["ignore", log, log],
      env: process.env,
      windowsHide: true,
    });
    fs.closeSync(log); // the child keeps its own handle
    proc.on("error", (err) => console.error("[overlay] could not start the server (is Node.js on PATH?):", err.message));
    if (proc.pid) lowerPriority(proc.pid);
    serverProc = proc;
    proc.on("exit", (code) => {
      if (code && !quitting) console.error(`[overlay] server exited with code ${code}`);
      if (serverProc === proc) serverProc = null;
    });
    for (let i = 0; i < 60; i++) {
      if (await serverUp()) return;
      if (quitting) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.error("[overlay] server did not come up within 30s. Run `npm start` manually to see the error.");
  } finally {
    starting = false;
  }
}

// ── server watchdog ───────────────────────────────────────────────────────────
// If the server dies (crash, Ctrl+C in its console, killed by hand) the overlay would otherwise sit on
// "server offline" forever. Check every few seconds and start it again; the overlay page reconnects
// its WebSocket by itself. Restarts back off so a server that crashes on boot doesn't spin.
const WATCHDOG_INTERVAL_MS = 5000;
const RESTART_BACKOFF_MS = [0, 5_000, 15_000, 30_000, 60_000];
let restartCount = 0;
let nextRestartAt = 0;
let healthySince = 0;

async function watchdogTick() {
  if (quitting || starting) return;
  lowerAppPriority();
  if (await serverUp()) {
    if (!healthySince) healthySince = Date.now();
    // A minute of uptime means the last restart worked; forget the backoff
    if (restartCount && Date.now() - healthySince > 60_000) restartCount = 0;
    return;
  }
  healthySince = 0;
  if (Date.now() < nextRestartAt) return;
  console.warn("[overlay] coach server is not responding, restarting it…");
  restartCount++;
  nextRestartAt = Date.now() + RESTART_BACKOFF_MS[Math.min(restartCount, RESTART_BACKOFF_MS.length - 1)];
  await ensureServer();
}

// ── window ────────────────────────────────────────────────────────────────────
function applyLock() {
  if (!win) return;
  // Locked: clicks pass through to the game and the window never takes focus away from Dota.
  win.setIgnoreMouseEvents(locked); // no { forward: true }: see the grab handle note in createWindow
  win.setFocusable(!locked);
  win.setResizable(!locked);
  if (!locked) win.focus();
  win.webContents.send("overlay:mode", { locked, hotkeys: HOTKEY_LABELS, calibrated: true }); // the top bar is located automatically now; manual calibration is only an override
  refreshTray();
}

function createWindow() {
  win = new BrowserWindow({
    ...initialBounds(),
    minWidth: 240,
    minHeight: 120,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The overlay is click-through, so it never gets the click Chromium wants before playing audio.
      // Without this the open/close sounds would stay silent.
      autoplayPolicy: "no-user-gesture-required",
    },
    // Never appear before click-through is on: a window that shows first and goes click-through only after the
    // page loads can swallow game clicks for a moment, and showing it normally can pull focus from the game.
    show: false,
  });
  if (locked) win.setIgnoreMouseEvents(true);
  win.once("ready-to-show", () => win?.showInactive());
  // "screen-saver" keeps it above borderless-fullscreen games on Windows and macOS
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // This window only ever shows the local coach. Anything else opens in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(BASE)) e.preventDefault();
  });

  const persist = () => win && saveBounds(win.getBounds());
  win.on("moved", persist);
  win.on("resized", persist);
  win.webContents.on("did-finish-load", applyLock);
  // The page reports its content height while locked; grow/shrink the window to fit so nothing is cut off.
  // Width and position stay as you set them. Bounded so a runaway page can't cover the screen.
  ipcMain.removeAllListeners("overlay:height");
  ipcMain.on("overlay:height", (e, px) => {
    if (!win || e.sender !== win.webContents || !locked || typeof px !== "number") return;
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const [w, h] = win.getSize();
    const target = Math.max(120, Math.min(px, Math.round(area.height * 0.8)));
    if (Math.abs(target - h) > 4) win.setSize(w, target);
  });

  // The grab handle: while the pointer is over it, the locked window takes mouse input so it can be dragged;
  // everywhere else clicks keep passing through to the game. It never takes keyboard focus (focusable stays off).
  //
  // The pointer is found by asking for its position a few times a second, NOT with
  // setIgnoreMouseEvents(..., { forward: true }): on Windows that option installs a system-wide low-level
  // mouse hook in this process, so every mouse movement in every app (the game included) has to wait for
  // this process to answer. With the overlay at below-normal priority next to a busy game, that made the
  // mouse stutter and input lag. Plain click-through has no hook and costs the game nothing.
  ipcMain.removeAllListeners("overlay:interactive"); // older pages may still send it; ignored
  clearInterval(gripWatch);
  let gripActive = false;
  gripWatch = setInterval(() => {
    if (!win || !locked || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const overGrip = p.x >= b.x + b.width / 2 - 40 && p.x <= b.x + b.width / 2 + 40 && p.y >= b.y && p.y <= b.y + 24;
    // While a drag is in progress the window stays interactive even if the pointer outruns it
    const want = overGrip || dragging;
    if (want === gripActive) return;
    gripActive = want;
    win.setIgnoreMouseEvents(!want);
  }, 200);
  // will-move fires repeatedly while dragging; treat the drag as over once it stops firing (or the move ends)
  win.on("will-move", () => {
    dragging = true;
    clearTimeout(dragEnd);
    dragEnd = setTimeout(() => (dragging = false), 1200);
  });
  win.on("moved", () => (dragging = false));

  win.on("closed", () => {
    win = null;
  });

  win.loadURL(`${BASE}/overlay`);
}

// ── actions ───────────────────────────────────────────────────────────────────
function toggleVisible() {
  if (!win) return;
  const showing = !win.isVisible();
  // Tell the page first so it can play the open/close sound. A hidden window keeps playing audio, so
  // hiding right away doesn't cut the close sound. Calibration hides/shows the window without this event.
  win.webContents.send("overlay:visibility", { visible: showing });
  if (showing) win.showInactive(); // show without stealing focus from the game
  else win.hide();
  refreshTray();
}

function toggleLock() {
  locked = !locked;
  applyLock();
}

async function quickAsk() {
  try {
    const res = await fetch(`${BASE}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What should I do right now?" }),
    });
    if (!res.ok) console.warn("[overlay] quick ask:", (await res.json().catch(() => ({}))).error ?? res.status);
  } catch (err) {
    console.warn("[overlay] quick ask failed:", err);
  }
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: win?.isVisible() ? "Hide overlay" : "Show overlay", accelerator: HOTKEYS.toggle, click: toggleVisible },
      { label: locked ? "Unlock (move / resize)" : "Lock (click-through)", accelerator: HOTKEYS.lock, click: toggleLock },
      { label: "Ask the AI coach now", accelerator: HOTKEYS.ask, click: quickAsk },
      { type: "separator" },
      { label: loadSettings().calibration ? "Adjust enemy detection (manual)…" : "Adjust enemy detection (optional)…", click: () => void calibrate() },
      { label: "Open full dashboard", click: () => shell.openExternal(BASE) },
      { label: "Open server log", click: () => void shell.openPath(serverLogFile()) },
      ...(process.platform === "win32"
        ? [{ label: "Start with Windows", type: /** @type {const} */ ("checkbox"), checked: autostartEnabled(), click: () => setAutostart(!autostartEnabled()) }]
        : []),
      {
        label: "Move overlay to",
        submenu: [
          { label: "Top right", click: () => moveTo("top-right") },
          { label: "Top left", click: () => moveTo("top-left") },
          { label: "Right, middle", click: () => moveTo("right") },
          { label: "Left, middle", click: () => moveTo("left") },
          ...(screen.getAllDisplays().length > 1 ? [{ type: /** @type {const} */ ("separator") }, { label: "Other monitor", click: moveToNextDisplay }] : []),
          { type: /** @type {const} */ ("separator") },
          {
            label: "Reset position",
            click: () => {
              if (!win) return;
              win.setBounds(defaultBounds());
              saveBounds(win.getBounds());
            },
          },
        ],
      },
      { type: "separator" },
      { label: "Quit Dota Coach overlay", click: () => app.quit() },
    ]),
  );
}

// ── start with Windows ────────────────────────────────────────────────────────
// Login starts the same no-window launcher as the desktop icon (run-overlay.vbs), so updates and the
// server come up exactly as they do by hand. On by default the first time; the tray checkbox turns it off.
const LOGIN_ITEM = {
  path: path.join(process.env.WINDIR ?? "C:\\Windows", "System32", "wscript.exe"),
  args: [path.join(ROOT, "run-overlay.vbs")],
};

function autostartEnabled() {
  return app.getLoginItemSettings(LOGIN_ITEM).openAtLogin;
}

/** @param {boolean} on */
function setAutostart(on) {
  app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin: on, name: "Dota Coach" });
  saveSettings({ autostart: on });
  refreshTray();
}

// ── enemy detection (top-bar portraits) ──────────────────────────────────────
// GSI never tells a player who the enemies are, but the top bar shows every hero's portrait to
// everyone. We capture just those two strips, shrink each portrait to 48x27 and let the local server
// match them against the hero art. Nothing leaves the machine, and capture stops once the lineup is
// known or the user has typed it in.

// Kept light so the game never feels it: the screen is grabbed at half resolution (a quarter of the pixels; the
// matcher only looks at a 24x14 grid per portrait, so detail beyond that is wasted), every 4 seconds, and only
// while the server still wants enemies. When several grabs in a row change nothing, it slows to every 12s.
const DETECT_INTERVAL_MS = 4000;
const DETECT_SCALE = 0.5;
const IDLE_AFTER = 6; // grabs without a new enemy before slowing down
const IDLE_EVERY = 3; // then grab on one tick in three
let unchangedGrabs = 0;
let skipTick = 0;
let lastEnemyCount = -1;
const SLOT_W = 48;
const SLOT_H = 27;
let detecting = false;

// Where the ten top-bar portraits are, with no setup. Measured in-game at 2560x1440: Radiant x 725-1140,
// Dire x 1420-1835 (symmetric about the centre), portraits y 4-52. Dota's HUD scales with screen height, so
// offsets are kept in units of screen height from the centre line; that carries over to other resolutions.
// Rows are taken at y 6-50 (clear of the team-colour strip and rank chevron), which matched best on real captures.
const TOPBAR = { inner: 140 / 1440, outer: 555 / 1440, top: 6 / 1440, bottom: 50 / 1440 };
/** Each slot loses this share of its width on both sides: the portraits are slanted at the edges */
const SLOT_INSET = 0.1;

/** Portrait rows for a display, as fractions of the screen (what the manual calibration also stores) @param {Electron.Display} display @returns {Calibration} */
function autoCalibration(display) {
  const { width: W, height: H } = display.size;
  const span = ((TOPBAR.outer - TOPBAR.inner) * H) / W;
  const y = TOPBAR.top;
  const h = TOPBAR.bottom - TOPBAR.top;
  return {
    radiant: { x: 0.5 - (TOPBAR.outer * H) / W, y, w: span, h },
    dire: { x: 0.5 + (TOPBAR.inner * H) / W, y, w: span, h },
    displayId: display.id,
  };
}

/** A manual calibration wins; otherwise the computed one for the display the overlay sits on (Dota's screen) */
function activeCalibration() {
  return loadSettings().calibration ?? autoCalibration(targetDisplay());
}

/** The display the user calibrated on, or the one the overlay sits on */
function targetDisplay() {
  const id = loadSettings().calibration?.displayId;
  return screen.getAllDisplays().find((d) => d.id === id) ?? (win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay());
}

/** Screenshot of one display; scale < 1 asks the compositor for a smaller image (much cheaper to copy) */
async function captureDisplay(display = targetDisplay(), scale = 1) {
  const size = {
    width: Math.round(display.size.width * display.scaleFactor * scale),
    height: Math.round(display.size.height * display.scaleFactor * scale),
  };
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size });
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  return { image: src?.thumbnail, display };
}

/** Electron bitmaps are BGRA; the server wants packed RGB. @param {Electron.NativeImage} img */
function toRgbBase64(img) {
  const bgra = img.toBitmap();
  const rgb = Buffer.alloc((bgra.length / 4) * 3);
  for (let i = 0, j = 0; i < bgra.length; i += 4, j += 3) {
    rgb[j] = bgra[i + 2];
    rgb[j + 1] = bgra[i + 1];
    rgb[j + 2] = bgra[i];
  }
  return rgb.toString("base64");
}

/** Five equal slots inside a calibrated strip @param {Electron.NativeImage} shot @param {Rect01} r */
function slots(shot, r) {
  const { width, height } = shot.getSize();
  const slotW = (r.w * width) / 5;
  const inset = slotW * SLOT_INSET;
  return Array.from({ length: 5 }, (_, i) =>
    toRgbBase64(
      shot
        .crop({ x: Math.round(r.x * width + i * slotW + inset), y: Math.round(r.y * height), width: Math.max(1, Math.round(slotW - 2 * inset)), height: Math.max(1, Math.round(r.h * height)) })
        .resize({ width: SLOT_W, height: SLOT_H, quality: "good" }),
    ),
  );
}

/** Whole portraits as PNGs, enlarged 3x so small top-bar art is readable @param {Electron.NativeImage} shot @param {Rect01} r */
function slotPngs(shot, r) {
  const { width, height } = shot.getSize();
  const slotW = (r.w * width) / 5;
  const w = Math.max(1, Math.round(slotW));
  const h = Math.max(1, Math.round(r.h * height));
  return Array.from({ length: 5 }, (_, i) =>
    shot
      .crop({ x: Math.round(r.x * width + i * slotW), y: Math.round(r.y * height), width: w, height: h })
      .resize({ width: w * 3, height: h * 3, quality: "best" })
      .toPNG()
      .toString("base64"),
  );
}

async function detectionTick() {
  if (detecting) return;
  const cal = activeCalibration();
  detecting = true;
  try {
    const status = await (await fetch(`${BASE}/api/vision/status`, { signal: AbortSignal.timeout(1500) })).json();
    if (!status.wanted) {
      unchangedGrabs = 0;
      lastEnemyCount = -1;
      return;
    }
    // The matcher is stuck on some slots (arcana/persona art): send one sharp set of portraits for the AI.
    // A single full-resolution grab, at most twice per match (the server decides when).
    if (status.hiRes) {
      const { image: sharp } = await captureDisplay(targetDisplay(), 1);
      if (sharp && !sharp.isEmpty()) {
        await fetch(BASE + "/api/vision/portraits", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ radiant: slotPngs(sharp, cal.radiant), dire: slotPngs(sharp, cal.dire) }),
          signal: AbortSignal.timeout(30_000),
        });
        unchangedGrabs = 0;
        skipTick = 0;
      }
      return;
    }
    // Nothing new for a while (e.g. a hero we can't recognise): grab less often
    if (unchangedGrabs >= IDLE_AFTER && skipTick++ % IDLE_EVERY !== 0) return;
    const { image } = await captureDisplay(targetDisplay(), DETECT_SCALE);
    if (!image || image.isEmpty()) {
      // macOS returns an empty image until Screen Recording permission is granted
      console.warn("[overlay] screen capture returned nothing. On macOS allow Screen Recording for this app.");
      return;
    }
    const res = await fetch(`${BASE}/api/vision/topbar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ w: SLOT_W, h: SLOT_H, radiant: slots(image, cal.radiant), dire: slots(image, cal.dire) }),
      signal: AbortSignal.timeout(10_000), // the first call downloads hero portraits
    });
    const count = ((await res.json().catch(() => ({})))?.enemies ?? []).length;
    if (count !== lastEnemyCount) {
      lastEnemyCount = count;
      unchangedGrabs = 0;
      skipTick = 0;
    } else unchangedGrabs++;
  } catch {
    /* server busy or restarting; try again next tick */
  } finally {
    detecting = false;
  }
}

/** @type {BrowserWindow | null} */
let calibWin = null;

/** Freeze a screenshot and let the user mark the two portrait rows on it */
async function calibrate() {
  if (calibWin) return calibWin.focus();
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  win?.hide(); // keep the overlay out of the screenshot
  await new Promise((r) => setTimeout(r, 250));
  const { image } = await captureDisplay(display);
  win?.showInactive();
  if (!image || image.isEmpty()) {
    console.warn("[overlay] could not capture the screen for calibration (macOS: allow Screen Recording).");
    return;
  }

  calibWin = new BrowserWindow({
    ...display.bounds,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreen: process.platform !== "darwin",
    webPreferences: { preload: path.join(__dirname, "preload-calibrate.cjs"), contextIsolation: true, sandbox: true },
  });
  calibWin.setAlwaysOnTop(true, "screen-saver");
  calibWin.webContents.once("did-finish-load", () => calibWin?.webContents.send("calib:image", image.toDataURL()));
  calibWin.on("closed", () => {
    calibWin = null;
    // Also covers Alt+F4: never leave listeners behind for the next calibration
    ipcMain.removeAllListeners("calib:save");
    ipcMain.removeAllListeners("calib:cancel");
  });
  calibWin.loadFile(path.join(__dirname, "calibrate.html"));

  /** @param {unknown} rects */
  const valid = (rects) => {
    const r = /** @type {any} */ (rects);
    const ok = (/** @type {any} */ x) => x && [x.x, x.y, x.w, x.h].every((v) => typeof v === "number" && v >= 0 && v <= 1);
    return ok(r?.radiant) && ok(r?.dire) ? /** @type {{ radiant: Rect01; dire: Rect01 }} */ (r) : null;
  };
  const done = () => {
    ipcMain.removeAllListeners("calib:save");
    ipcMain.removeAllListeners("calib:cancel");
    calibWin?.close();
  };
  ipcMain.on("calib:save", (_e, rects) => {
    const r = valid(rects);
    if (r) {
      saveSettings({ calibration: { radiant: r.radiant, dire: r.dire, displayId: display.id } });
      applyLock(); // tells the overlay it's calibrated
    }
    done();
  });
  ipcMain.on("calib:cancel", done);
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Transparency needs compositing; some Linux GPUs draw a black box without this.
  if (process.platform === "linux") app.commandLine.appendSwitch("enable-transparent-visuals");

  // A small text panel doesn't need the GPU. Software rendering keeps the overlay off the graphics card
  // the game is using (no shared GPU queue, no driver-level hiccups) and drops the ~100 MB GPU process.
  // Set COACH_OVERLAY_GPU=1 to turn hardware acceleration back on if text ever looks wrong.
  if (process.env.COACH_OVERLAY_GPU !== "1") app.disableHardwareAcceleration();
  // Keep V8 small: the overlay page holds almost nothing.
  app.commandLine.appendSwitch("js-flags", "--max-old-space-size=128");
  lowerPriority(process.pid);

  app.whenReady().then(async () => {
    await ensureServer();
    createWindow();

    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")));
    tray.setToolTip("Dota Coach overlay");
    setInterval(() => void detectionTick(), DETECT_INTERVAL_MS);
    setInterval(() => void watchdogTick(), WATCHDOG_INTERVAL_MS);
    lowerAppPriority();
    if (process.platform === "win32" && loadSettings().autostart === undefined) setAutostart(true);
    tray.on("click", toggleVisible);
    refreshTray();

    const failed = Object.entries(HOTKEYS)
      .filter(([name, key]) => !globalShortcut.register(key, { toggle: toggleVisible, lock: toggleLock, ask: quickAsk }[name] ?? (() => {})))
      .map(([, key]) => key);
    if (failed.length) console.warn(`[overlay] hotkeys already taken by another app: ${failed.join(", ")} (use the tray menu)`);
  });

  app.on("second-instance", () => win?.showInactive());
  app.on("will-quit", () => {
    quitting = true;
    globalShortcut.unregisterAll();
    serverProc?.kill();
  });
  // Tray app: closing the window doesn't quit; use the tray menu.
  app.on("window-all-closed", () => {});
}
