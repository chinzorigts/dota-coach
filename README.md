# Dota Coach

A real-time Dota 2 coach. It reads the game's state through Valve's Game State Integration (GSI) and shows **what to buy next, which skill to level, danger signals and map timers**, while Claude reads the situation and gives advice. Use it as an **in-game overlay**, on a second monitor, or in your phone's browser.

```
Dota 2 ──(GSI, POST every ~0.5s)──► local server :3001 ──(WebSocket)──► dashboard  (browser / phone)
                                         │                         └──► overlay    (Electron, over the game)
                                         ├─ rule engine: items · skills · alerts · timers (always, instant)
                                         ├─ OpenDota: this hero's real popular builds (cached 24h)
                                         └─ Claude: on death, every 5 min, lineup change, or when you ask
```

## Is it safe? (VAC)

Data comes only from **Valve's official Game State Integration**: the game reads a config file and sends its own state to localhost. Nothing reads game memory or injects into the game, and the overlay is an ordinary separate window.

The trade-off: **while you play, GSI only describes your own hero.** Enemy items and positions are never sent. Enemy *heroes* are filled in automatically (see [Enemy auto-detection](#enemy-auto-detection)), or you can type them at the bottom of the dashboard. They feed counter items and the AI analysis.

## Getting started

Requires Node.js 20.12+.

```bash
npm install
npm run install-cfg         # puts the GSI config file in your Dota 2 folder
npm run build && npm start  # dashboard at http://127.0.0.1:3001
```

To turn on AI advice, open **Settings** (gear icon, or `http://127.0.0.1:3001/#settings`) and paste your Anthropic API key. Everything else works without it.

Then in Steam open **Dota 2 > Properties > Launch Options**, add `-gamestateintegration`, and restart Dota 2. A bot match is the quickest check.

If `install-cfg` can't find your install, pass the path:

```bash
npm run install-cfg -- "D:\SteamLibrary\steamapps\common\dota 2 beta"
```

## Settings

Open the gear icon in the dashboard (or `/#settings`). Changes save as you make them and apply immediately, no restart.

| Section | What you can change |
|---|---|
| AI coach | API key (save, test, remove), on/off, model (Opus / Sonnet / Haiku), thinking depth, which moments trigger automatic analysis, minimum interval |
| Coaching | Default role, low-HP warning threshold, gold reminder threshold, which timers to show |
| Overlay | Which sections appear, background opacity, text size |
| Enemy auto-detection | On/off |

- Settings are stored in `.data/settings.json`, the API key in `.data/secrets.json` (file mode 600). Both are git-ignored. The key is never sent to the browser; the screen only shows its last four characters.
- Values in `.env` (`COACH_MODEL`, `COACH_EFFORT`, `COACH_AI_MIN_INTERVAL`, `ANTHROPIC_API_KEY`, ...) seed the defaults, so an existing setup keeps working. A key saved in Settings overrides `ANTHROPIC_API_KEY`.
- **Settings can only be changed on the PC running Dota Coach.** With `HOST=0.0.0.0` other devices can open the settings screen read-only, but can't change the key or anything that affects cost.

## In-game overlay

```bash
npm run overlay
```

This builds the UI, starts the coach server if it isn't already running, and opens a small transparent window on top of the game (right side, below the top bar).

**Set Dota 2 to Borderless window** (Settings > Video > Display Mode). In exclusive fullscreen the game owns the screen and no external window can be drawn over it. That limit applies to every external overlay, not just this one.

| Hotkey | Action |
|---|---|
| `Ctrl+Shift+L` | Unlock / lock. Locked (default): clicks pass through to the game and the window never steals focus. Unlocked: drag to move, resize from the edges, type a question. Position is remembered |
| `Ctrl+Shift+H` | Show / hide |
| `Ctrl+Shift+Q` | Ask the AI "What should I do right now?" without leaving the game |

On macOS use `⌘⇧` instead of `Ctrl+Shift`. The same actions plus **Open full dashboard** and **Reset position** are in the tray icon menu. If another app already owns a hotkey, the overlay prints a warning and the tray menu still works.

The overlay shows only what changes a decision mid-fight: next item with a gold bar, next skill or talent, danger alerts, the two nearest timers, and a short AI summary.

## Enemy auto-detection

Enemy heroes are filled in three ways, in this order of precedence:

1. **You.** Anything you type in the dashboard wins and is never overwritten. Remove every hero to hand control back to auto-detection.
2. **Game data.** When GSI does include picks (spectating, or draft data when the game sends it), they are used as-is.
3. **The top bar, via the overlay.** Every player sees all ten hero portraits on the top bar. The overlay captures just those two strips, shrinks each portrait to 48×27 pixels and the local server matches it against the official hero art. Only what is already on your screen is read; nothing leaves your PC, and capture stops as soon as all five enemies are known.

One-time setup (about 10 seconds, during any game where the top bar is visible):

1. `npm run overlay`, then in the tray menu choose **Set up enemy detection…**
2. The screen freezes. Drag a box over the **five Radiant portraits** (left of the clock), then over the **five Dire portraits**. The dashed lines should split each box into the five portraits.
3. **Save.**

Detection checks itself: your own hero must show up in your team's row. If you drew the boxes the wrong way round it swaps them automatically; if your hero can't be found, the dashboard asks you to recalibrate. A hero is only confirmed after it is recognized on three consecutive captures. Recalibrate after changing resolution or HUD settings.

On macOS, allow **Screen Recording** for the overlay app (System Settings > Privacy & Security) or captures come back empty. The first detection downloads the hero portraits once (a few MB, cached in `.cache/heroes`).

### Preview without a game

```bash
npm start            # terminal 1
npm run mock         # terminal 2: a fake Juggernaut game at 20x speed
npm run mock -- --speed 5 --start 900 --hero npc_dota_hero_axe --hero-id 2
```

Open `http://127.0.0.1:3001/overlay` in a browser to see the overlay layout without Electron.

### Development

```bash
npm run dev:server   # :3001 (tsx watch)
npm run dev:web      # :5173 (Vite, proxies /api and /ws to :3001)
npm test             # server unit + integration tests (vitest)
npm run typecheck    # server, web and overlay
```

### Viewing on a phone

Set `HOST=0.0.0.0` in `.env` and open `http://<your PC's IP>:3001` on the same Wi-Fi.
Anyone on that network can then see the dashboard and **send AI questions (which cost API credits)**. GSI ingestion stays protected by the token.

## What it recommends

| Area | Based on |
|---|---|
| Items | ① basic rules (e.g. no TP) ② Claude's picks ③ counters to the enemy lineup (invisibility, illusions, healing, evasion, magic burst, silences, physical burst, buffs) ④ OpenDota popular builds, or a default build by primary attribute and role when OpenDota is unreachable. Shows **gold still needed** after subtracting components you own |
| Skills | Ultimate first, then talents (10/15/20/25), then basic abilities in priority order (Claude's order when available, otherwise slot order). Unspent points are computed from your level |
| Alerts | Low HP/mana, dead with buyback available, unspent points, gold piling up, late-game buyback reserve, no TP, disables |
| Timers | Bounty/power/wisdom runes, lotus, day/night, camp stack (:53), Roshan (when GSI provides it) |

## AI advice (Claude)

- Runs when your hero is locked in, after a death (30s cooldown), every 5 minutes (at least `COACH_AI_MIN_INTERVAL` apart), when the enemy lineup changes, and when you ask
- Default model `claude-opus-5-5` with fast thinking depth (quick responses mid-game). Change the model, depth and triggers in Settings; Haiku is the lowest-cost option
- Server-side refusal fallback (`fallbacks: "default"`) is enabled
- Output is constrained to a JSON schema, and item keys that don't exist are dropped

## When a patch lands

- Heroes, items, abilities: `npm update dotaconstants -w server`
- Rune and event intervals: `server/src/engine/timers.ts` (`approx: true` marks values that change often)
- Counter table: `server/src/engine/counters.ts`. A test checks every hero and item key exists
- Levels that grant no ability point: `NO_POINT_LEVELS` in `server/src/engine/skills.ts`

## Known limits

- Unspent ability points are approximate: heroes that gain a level-1 ability from Shard/Scepter can undercount
- The overlay cannot appear over exclusive fullscreen (see above)
- Enemy auto-detection needs the overlay running and a one-time calibration. Portrait matching was tested against synthetic images; if a hero is misread in a real game, type the lineup in and please report it

## Layout

```
server/src
  gsi/        raw GSI types and normalization
  data/       dotaconstants (static) · OpenDota (popular builds, cached)
  engine/     items · skills · alerts · timers · counters → CoachReport
  ai/         Claude prompt · triggers/throttle · API call
  vision/     top-bar portrait matching (image helpers, matcher, streak/calibration detector, hero art cache)
  settings.ts settings store (validation, .data/ persistence, API key handling)
  state.ts    match state (enemies, role, popular build, AI result)
  app.ts      HTTP (/gsi, /api/*) + WebSocket (/ws) + static files
  tools/      install-cfg · mock-gsi
web/src       React dashboard; overlay/ holds the compact overlay view (/overlay)
overlay/      Electron shell: transparent click-through window, hotkeys, tray, calibration + top-bar capture
```
