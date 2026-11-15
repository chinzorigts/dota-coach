// Portrait matcher: compares a captured top-bar slot against every hero portrait.
//
// Each image is shrunk to a small fixed grid and turned into a zero-mean, unit-length vector, so the
// score is a normalized cross-correlation in [-1, 1]. That makes it robust to HUD brightness, scaling
// and JPEG-ish blur. Dead heroes are shown greyed out, so a grayscale comparison runs alongside color.
//
// The top bar crops portraits a little differently from the store art, so each template is stored at a
// few crop variants and the best one wins.
import { crop, resize, type RGBImage } from "./image.js";

export const GRID_W = 24;
export const GRID_H = 14;

/** Center crops tried for each template (fraction of width/height kept) */
const VARIANTS = [1, 0.9, 0.8];

export interface Features {
  color: Float32Array;
  gray: Float32Array;
}

function normalize(v: Float32Array): Float32Array {
  let mean = 0;
  for (const x of v) mean += x;
  mean /= v.length;
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    v[i] -= mean;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  if (norm < 1e-6) return v.fill(0); // flat image (empty slot) matches nothing
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

export function features(img: RGBImage): Features {
  const small = resize(img, GRID_W, GRID_H);
  const n = GRID_W * GRID_H;
  const color = new Float32Array(n * 3);
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = small.data[i * 3], g = small.data[i * 3 + 1], b = small.data[i * 3 + 2];
    // Channels are normalized together, so hue differences still count
    color[i * 3] = r;
    color[i * 3 + 1] = g;
    color[i * 3 + 2] = b;
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { color: normalize(color), gray: normalize(gray) };
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Color match for living heroes; grayscale (slightly discounted) covers greyed-out dead ones */
export function similarity(a: Features, b: Features): number {
  return Math.max(dot(a.color, b.color), dot(a.gray, b.gray) * 0.97);
}

export interface Match {
  key: string;
  score: number;
}

export class TemplateBank {
  private templates = new Map<string, Features[]>();

  add(key: string, img: RGBImage) {
    const variants = VARIANTS.map((f) =>
      features(f === 1 ? img : crop(img, (img.w * (1 - f)) / 2, (img.h * (1 - f)) / 2, img.w * f, img.h * f)),
    );
    // A hero can have several looks (base art plus learned arcana/persona portraits): keep them all
    this.templates.set(key, [...(this.templates.get(key) ?? []), ...variants]);
  }

  get size() {
    return this.templates.size;
  }

  /** Best matches for one slot, highest first */
  match(slot: RGBImage, top = 3): Match[] {
    const f = features(slot);
    const out: Match[] = [];
    for (const [key, variants] of this.templates) {
      let best = -1;
      for (const v of variants) best = Math.max(best, similarity(f, v));
      out.push({ key, score: best });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, top);
  }
}
