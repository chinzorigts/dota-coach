// Match recorder: a small timeline of each game in .data/matches/<matchId>.jsonl, one JSON object per line.
// It is there to check the coach against real games afterwards: what it recommended and when, what you bought,
// what the AI said, how enemy detection went. Writes are appended in the background and stay small
// (a line every 30 game seconds plus events, a few hundred lines a game). The newest KEEP files are kept.
import fs from "node:fs";
import path from "node:path";
import type { GameSnapshot } from "../gsi/normalize.js";
import type { CoachReport } from "../engine/types.js";
import type { AiAdvice } from "../ai/advisor.js";
import type { Purchase } from "../engine/purchases.js";

const TICK_SEC = 30;
const KEEP = 30;

export type RecordLine = Record<string, unknown> & { t: string; clock?: number; at?: number };

export class MatchRecorder {
  private matchId: string | null = null;
  private lastTick = -Infinity;
  private lastAdviceAt = 0;
  private lastEnemies = "";
  private ended = false;
  private queue: Promise<void> = Promise.resolve();

  /** dir null: keep lines in memory only (tests) */
  constructor(
    private dir: string | null,
    private memory: RecordLine[] | null = null,
  ) {}

  private write(line: RecordLine) {
    const full = { ...line, at: Date.now() };
    if (this.memory) this.memory.push(full);
    if (!this.dir || !this.matchId) return;
    const file = path.join(this.dir, this.matchId.replace(/[^\w-]/g, "") + ".jsonl");
    const text = JSON.stringify(full) + "\n";
    this.queue = this.queue
      .then(() => fs.promises.mkdir(this.dir!, { recursive: true }))
      .then(() => fs.promises.appendFile(file, text))
      .catch((err) => console.warn("[recorder] write failed:", (err as Error).message));
  }

  private prune() {
    if (!this.dir) return;
    const dir = this.dir;
    this.queue = this.queue
      .then(async () => {
        const names = (await fs.promises.readdir(dir)).filter((n) => n.endsWith(".jsonl"));
        if (names.length <= KEEP) return;
        const dated = await Promise.all(names.map(async (n) => ({ n, m: (await fs.promises.stat(path.join(dir, n))).mtimeMs })));
        dated.sort((a, b) => b.m - a.m);
        await Promise.all(dated.slice(KEEP).map((d) => fs.promises.unlink(path.join(dir, d.n))));
      })
      .catch(() => undefined);
  }

  /** Called on every GSI update, after the report is computed */
  update(
    s: GameSnapshot,
    report: CoachReport | null,
    ctx: { enemies: string[]; enemySource: string; detection: string | null; bought: Purchase[]; advice: AiAdvice | null },
  ) {
    if (!s.matchId) return;
    if (s.matchId !== this.matchId) {
      this.matchId = s.matchId;
      this.lastTick = -Infinity;
      this.lastAdviceAt = 0;
      this.lastEnemies = "";
      this.ended = false;
      this.write({ t: "start", hero: s.hero?.name ?? null, team: s.team, clock: s.clockTime });
      this.prune();
    }
    const clock = Math.round(s.clockTime);

    const enemies = ctx.enemies.join(",") + "|" + ctx.enemySource;
    if (enemies !== this.lastEnemies) {
      this.lastEnemies = enemies;
      this.write({ t: "enemies", clock, list: ctx.enemies, source: ctx.enemySource, detection: ctx.detection });
    }

    for (const b of ctx.bought) this.write({ t: "buy", clock, item: b.item, followed: b.followed, replaced: b.replaced });

    const a = ctx.advice;
    if (a && a.at !== this.lastAdviceAt) {
      this.lastAdviceAt = a.at;
      this.write({
        t: "ai",
        clock,
        reason: a.reason,
        summary: a.summary,
        items: a.next_items.map((i) => i.item),
        skills: a.skill_build ?? null,
        danger: a.danger,
      });
    }

    if (s.inProgress && clock - this.lastTick >= TICK_SEC && report) {
      this.lastTick = clock;
      const p = s.player;
      this.write({
        t: "tick",
        clock,
        level: s.hero?.level ?? null,
        gold: p?.gold ?? null,
        netWorth: report.stats.netWorth,
        kda: report.stats.kda,
        lhPerMin: Math.round(report.stats.lhPerMin * 10) / 10,
        items: [...s.items.inventory, ...s.items.backpack].flatMap((i) => (i ? [i.name] : [])),
        recs: report.items.slice(0, 4).map((r) => r.key + ":" + r.source),
        skill: report.skills.next?.key ?? null,
        unspent: report.skills.unspent,
        upcoming: report.skills.upcoming ? report.skills.upcoming.key + "@" + report.skills.upcoming.atLevel : null,
        alerts: report.alerts.map((x) => x.id).slice(0, 4),
      });
    }

    if (s.winTeam && !this.ended) {
      this.ended = true;
      this.write({ t: "end", clock, won: s.winTeam === s.team, kda: report?.stats.kda ?? null });
    }
  }
}
