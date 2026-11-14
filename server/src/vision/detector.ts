// Turns per-frame portrait matches into a stable enemy lineup.
//
// A single frame can be wrong (a hero mid-death animation, a tooltip over the bar), so a slot is only
// confirmed after the same hero wins MIN_STREAK frames in a row with a clear margin over the runner-up.
// Your own hero (known from GSI) doubles as a calibration check: it must show up on your team's side.
// If it shows up on the other side, the two calibration rectangles were drawn the wrong way round
// and the sides are swapped automatically.
import type { RGBImage } from "./image.js";
import type { Match, TemplateBank } from "./matcher.js";

export const MIN_SCORE = 0.55;
export const MIN_MARGIN = 0.06;
export const MIN_STREAK = 3;

export type Side = "radiant" | "dire";

export interface SlotResult {
  hero: string | null; // accepted this frame
  score: number;
  confirmed: string | null;
}

export interface DetectionResult {
  enemies: string[]; // confirmed, in slot order
  enemySlots: SlotResult[];
  calibration: "ok" | "swapped" | "unverified" | "bad";
}

function accept(m: Match[]): { hero: string | null; score: number } {
  const [a, b] = m;
  if (!a) return { hero: null, score: 0 };
  const ok = a.score >= MIN_SCORE && a.score - (b?.score ?? -1) >= MIN_MARGIN;
  return { hero: ok ? a.key : null, score: +a.score.toFixed(3) };
}

export class EnemyDetector {
  private streak: { hero: string | null; count: number }[] = [];
  private confirmed: (string | null)[] = [];
  private swapped = false;
  private ownSeen = false;

  constructor(private bank: TemplateBank) {
    this.reset();
  }

  reset() {
    this.streak = Array.from({ length: 5 }, () => ({ hero: null, count: 0 }));
    this.confirmed = Array(5).fill(null);
    this.swapped = false;
    this.ownSeen = false;
  }

  update(frames: Record<Side, RGBImage[]>, myTeam: Side, myHero: string): DetectionResult {
    const radiant = frames.radiant.map((s) => accept(this.bank.match(s)));
    const dire = frames.dire.map((s) => accept(this.bank.match(s)));

    // Where did my own hero land?
    const inRadiant = radiant.some((r) => r.hero === myHero);
    const inDire = dire.some((r) => r.hero === myHero);
    const ownSide: Side | null = inRadiant && !inDire ? "radiant" : inDire && !inRadiant ? "dire" : null;
    if (ownSide) {
      this.swapped = ownSide !== myTeam;
      this.ownSeen = true;
    }

    const effectiveEnemy: Side = (myTeam === "radiant") !== this.swapped ? "dire" : "radiant";
    const enemyFrame = effectiveEnemy === "radiant" ? radiant : dire;
    const ownFrame = effectiveEnemy === "radiant" ? dire : radiant;

    // Confident matches on my side that never include my hero mean the rectangles are off
    const ownConfident = ownFrame.filter((r) => r.hero).length;
    const calibration: DetectionResult["calibration"] = this.ownSeen
      ? this.swapped ? "swapped" : "ok"
      : ownConfident >= 3 ? "bad" : "unverified";

    const enemySlots: SlotResult[] = enemyFrame.slice(0, 5).map((r, i) => {
      const st = this.streak[i];
      if (r.hero && r.hero === st.hero) st.count++;
      else Object.assign(st, { hero: r.hero, count: r.hero ? 1 : 0 });

      const taken = this.confirmed.some((c, j) => j !== i && c === r.hero);
      if (calibration !== "bad" && st.hero && st.count >= MIN_STREAK && !taken && st.hero !== myHero) {
        this.confirmed[i] = st.hero;
      }
      return { hero: r.hero, score: r.score, confirmed: this.confirmed[i] };
    });

    return {
      enemies: this.confirmed.filter((c): c is string => c !== null),
      enemySlots,
      calibration,
    };
  }
}
