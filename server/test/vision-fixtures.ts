import { crop, makeImage, resize, type RGBImage } from "../src/vision/image.js";

// Deterministic PRNG so failures are reproducible
export function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A fake 128x72 "portrait": a few colored blobs on a gradient, unique per seed */
export function portrait(seed: number): RGBImage {
  const r = rng(seed);
  const img = makeImage(128, 72);
  const base = [r() * 255, r() * 255, r() * 255];
  const blobs = Array.from({ length: 5 }, () => ({ x: r() * 128, y: r() * 72, rad: 10 + r() * 25, c: [r() * 255, r() * 255, r() * 255] }));
  for (let y = 0; y < 72; y++) {
    for (let x = 0; x < 128; x++) {
      let c = base.map((v, k) => v * (0.6 + 0.4 * (k === 0 ? x / 128 : y / 72)));
      for (const b of blobs) {
        const d = Math.hypot(x - b.x, y - b.y);
        if (d < b.rad) c = b.c.map((v, k) => v * (1 - d / b.rad) + c[k] * (d / b.rad));
      }
      img.data.set(c.map((v) => Math.max(0, Math.min(255, v))), (y * 128 + x) * 3);
    }
  }
  return img;
}

/** What the screen capture gives us: tighter crop, small, dimmer, noisy; optionally greyed out (dead) */
export function captured(src: RGBImage, seed: number, opts: { dead?: boolean } = {}): RGBImage {
  const r = rng(seed);
  const c = resize(crop(src, src.w * 0.06, src.h * 0.05, src.w * 0.88, src.h * 0.9), 48, 27);
  for (let i = 0; i < c.data.length; i += 3) {
    let px = [c.data[i], c.data[i + 1], c.data[i + 2]].map((v) => v * 0.8 + 10);
    if (opts.dead) {
      const g = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
      px = [g * 0.6, g * 0.6, g * 0.6];
    }
    c.data.set(px.map((v) => Math.max(0, Math.min(255, v + (r() - 0.5) * 30))), i);
  }
  return c;
}


export const blank = () => makeImage(48, 27, new Uint8Array(48 * 27 * 3).fill(20));
