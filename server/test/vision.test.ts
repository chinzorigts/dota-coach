import { describe, expect, it } from "vitest";
import { captured, portrait, blank } from "./vision-fixtures.js";
import { TemplateBank } from "../src/vision/matcher.js";
import { EnemyDetector, MIN_STREAK } from "../src/vision/detector.js";

const HEROES = Array.from({ length: 130 }, (_, i) => `npc_dota_hero_h${i}`);
const ART = new Map(HEROES.map((h, i) => [h, portrait(i + 1)]));
const bank = new TemplateBank();
for (const [h, img] of ART) bank.add(h, img);


describe("matcher", () => {
  it("picks the right hero from a cropped, dimmed, noisy capture", () => {
    let correct = 0;
    for (let i = 0; i < 40; i++) {
      const hero = HEROES[(i * 7) % HEROES.length];
      if (bank.match(captured(ART.get(hero)!, i))[0].key === hero) correct++;
    }
    expect(correct).toBe(40);
  });

  it("still matches greyed-out (dead) portraits", () => {
    let correct = 0;
    for (let i = 0; i < 20; i++) {
      const hero = HEROES[(i * 11) % HEROES.length];
      if (bank.match(captured(ART.get(hero)!, 100 + i, { dead: true }))[0].key === hero) correct++;
    }
    expect(correct).toBeGreaterThanOrEqual(18);
  });

  it("gives an empty slot no meaningful score", () => {
    expect(bank.match(blank())[0].score).toBeLessThan(0.1);
  });
});

describe("EnemyDetector", () => {
  const me = HEROES[0];
  const allies = [me, HEROES[1], HEROES[2], HEROES[3], HEROES[4]];
  const foes = [HEROES[50], HEROES[60], HEROES[70], HEROES[80], HEROES[90]];
  const frame = (list: string[], seed: number) => list.map((h, i) => captured(ART.get(h)!, seed * 10 + i));

  it("confirms enemies only after the streak and checks calibration via my hero", () => {
    const d = new EnemyDetector(bank);
    let res = d.update({ radiant: frame(allies, 1), dire: frame(foes, 1) }, "radiant", me);
    expect(res.calibration).toBe("ok");
    expect(res.enemies).toEqual([]); // one frame is not enough
    for (let f = 2; f <= MIN_STREAK; f++) res = d.update({ radiant: frame(allies, f), dire: frame(foes, f) }, "radiant", me);
    expect(res.enemies).toEqual(foes);
  });

  it("swaps sides when the rectangles were drawn the wrong way round", () => {
    const d = new EnemyDetector(bank);
    let res;
    // I'm Dire, but my hero shows up in the 'dire' rectangle... no: rectangles swapped, so it's in 'radiant'
    for (let f = 1; f <= MIN_STREAK; f++) res = d.update({ radiant: frame(allies, f), dire: frame(foes, f) }, "dire", me);
    expect(res!.calibration).toBe("swapped");
    expect(res!.enemies).toEqual(foes);
  });

  it("refuses to confirm when my side is confident but my hero is missing (bad rectangles)", () => {
    const d = new EnemyDetector(bank);
    const strangers = [HEROES[20], HEROES[21], HEROES[22], HEROES[23], HEROES[24]];
    let res;
    for (let f = 1; f <= MIN_STREAK + 1; f++) res = d.update({ radiant: frame(strangers, f), dire: frame(foes, f) }, "radiant", me);
    expect(res!.calibration).toBe("bad");
    expect(res!.enemies).toEqual([]);
  });

  it("handles empty enemy slots (fewer than 5 players)", () => {
    const d = new EnemyDetector(bank);
    const partial = (seed: number) => [...frame(foes.slice(0, 3), seed), blank(), blank()];
    let res;
    for (let f = 1; f <= MIN_STREAK; f++) res = d.update({ radiant: frame(allies, f), dire: partial(f) }, "radiant", me);
    expect(res!.enemies).toEqual(foes.slice(0, 3));
  });
});
