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

// ── persisted window bounds ──────────────────────────────────────────────────
const settingsFile = () => path.join(app.getPath("userData"), "overlay.json");

/**
 * @typedef {{ x: number; y: number; w: number; h: number }} Rect01  fractions of the screen
 * @typedef {{ radiant: Rect01; dire: Rect01; displayId: number }} Calibration
 * @typedef {{ bounds?: Electron.Rectangle; calibration?: Calibration }} Settings
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

/** Start the coach server if nobody else has. Uses the system `node` (the one that ran npm install). */
async function ensureServer() {
  if (await serverUp()) return;
  console.log("[overlay] starting the coach server…");
  serverProc = spawn("node", ["--import", "tsx", "server/src/index.ts"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  serverProc.on("exit", (code) => {
    if (code) console.error(`[overlay] server exited with code ${code}`);
    serverProc = null;
  });
  for (let i = 0; i < 60; i++) {
    if (await serverUp()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error("[overlay] server did not come up within 30s. Run `npm start` manually to see the error.");
}

// ── window ────────────────────────────────────────────────────────────────────
function applyLock() {
  if (!win) return;
  // Locked: clicks pass through to the game and the window never takes focus away from Dota.
  win.setIgnoreMouseEvents(locked, { forward: true });
  win.setFocusable(!locked);
  win.setResizable(!locked);
  if (!locked) win.focus();
  win.webContents.send("overlay:mode", { locked, hotkeys: HOTKEY_LABELS, calibrated: Boolean(loadSettings().calibration) });
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
    },
  });
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
  win.on("closed", () => {
    win = null;
  });

  win.loadURL(`${BASE}/overlay`);
}

// ── actions ───────────────────────────────────────────────────────────────────
function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else win.showInactive(); // show without stealing focus from the game
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
      { label: loadSettings().calibration ? "Recalibrate enemy detection…" : "Set up enemy detection…", click: () => void calibrate() },
      { label: "Open full dashboard", click: () => shell.openExternal(BASE) },
      {
        label: "Reset position",
        click: () => {
          if (!win) return;
          win.setBounds(defaultBounds());
          saveBounds(win.getBounds());
        },
      },
      { type: "separator" },
      { label: "Quit Dota Coach overlay", click: () => app.quit() },
    ]),
  );
}

// ── enemy detection (top-bar portraits) ──────────────────────────────────────
// GSI never tells a player who the enemies are, but the top bar shows every hero's portrait to
// everyone. We capture just those two strips, shrink each portrait to 48x27 and let the local server
// match them against the hero art. Nothing leaves the machine, and capture stops once the lineup is
// known or the user has typed it in.

const DETECT_INTERVAL_MS = 2000;
const SLOT_W = 48;
const SLOT_H = 27;
let detecting = false;

/** The display the user calibrated on, or the one the overlay sits on */
function targetDisplay() {
  const id = loadSettings().calibration?.displayId;
  return screen.getAllDisplays().find((d) => d.id === id) ?? (win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay());
}

/** Full-resolution screenshot of one display */
async function captureDisplay(display = targetDisplay()) {
  const size = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
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
  return Array.from({ length: 5 }, (_, i) =>
    toRgbBase64(
      shot
        .crop({ x: Math.round(r.x * width + i * slotW), y: Math.round(r.y * height), width: Math.max(1, Math.round(slotW)), height: Math.max(1, Math.round(r.h * height)) })
        .resize({ width: SLOT_W, height: SLOT_H, quality: "good" }),
    ),
  );
}

async function detectionTick() {
  const cal = loadSettings().calibration;
  if (!cal || detecting) return;
  detecting = true;
  try {
    const status = await (await fetch(`${BASE}/api/vision/status`, { signal: AbortSignal.timeout(1500) })).json();
    if (!status.wanted) return;
    const { image } = await captureDisplay();
    if (!image || image.isEmpty()) {
      // macOS returns an empty image until Screen Recording permission is granted
      console.warn("[overlay] screen capture returned nothing. On macOS allow Screen Recording for this app.");
      return;
    }
    await fetch(`${BASE}/api/vision/topbar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ w: SLOT_W, h: SLOT_H, radiant: slots(image, cal.radiant), dire: slots(image, cal.dire) }),
      signal: AbortSignal.timeout(10_000), // the first call downloads hero portraits
    });
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

  app.whenReady().then(async () => {
    await ensureServer();
    createWindow();

    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")));
    tray.setToolTip("Dota Coach overlay");
    setInterval(() => void detectionTick(), DETECT_INTERVAL_MS);
    tray.on("click", toggleVisible);
    refreshTray();

    const failed = Object.entries(HOTKEYS)
      .filter(([name, key]) => !globalShortcut.register(key, { toggle: toggleVisible, lock: toggleLock, ask: quickAsk }[name] ?? (() => {})))
      .map(([, key]) => key);
    if (failed.length) console.warn(`[overlay] hotkeys already taken by another app: ${failed.join(", ")} (use the tray menu)`);
  });

  app.on("second-instance", () => win?.showInactive());
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    serverProc?.kill();
  });
  // Tray app: closing the window doesn't quit; use the tray menu.
  app.on("window-all-closed", () => {});
}
