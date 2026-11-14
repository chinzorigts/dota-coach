// Minimal RGB image helpers for portrait matching. No native deps: images here are tiny (tens of pixels).

export interface RGBImage {
  w: number;
  h: number;
  /** Packed RGB, length w*h*3 */
  data: Uint8Array;
}

export function makeImage(w: number, h: number, data?: Uint8Array): RGBImage {
  return { w, h, data: data ?? new Uint8Array(w * h * 3) };
}

/** RGBA (e.g. from pngjs) to RGB, compositing transparent pixels onto black like the game HUD does */
export function fromRGBA(w: number, h: number, rgba: Uint8Array | Buffer): RGBImage {
  const out = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < w * h * 4; i += 4, j += 3) {
    const a = rgba[i + 3] / 255;
    out[j] = rgba[i] * a;
    out[j + 1] = rgba[i + 1] * a;
    out[j + 2] = rgba[i + 2] * a;
  }
  return { w, h, data: out };
}

export function crop(img: RGBImage, x: number, y: number, w: number, h: number): RGBImage {
  x = Math.max(0, Math.min(img.w - 1, Math.round(x)));
  y = Math.max(0, Math.min(img.h - 1, Math.round(y)));
  w = Math.max(1, Math.min(img.w - x, Math.round(w)));
  h = Math.max(1, Math.min(img.h - y, Math.round(h)));
  const out = new Uint8Array(w * h * 3);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * img.w + x) * 3;
    out.set(img.data.subarray(src, src + w * 3), row * w * 3);
  }
  return { w, h, data: out };
}

/** Box-filter resize. Fine for downscaling, which is all we do. */
export function resize(img: RGBImage, w: number, h: number): RGBImage {
  const out = new Uint8Array(w * h * 3);
  const sx = img.w / w;
  const sy = img.h / h;
  for (let oy = 0; oy < h; oy++) {
    const y0 = Math.floor(oy * sy);
    const y1 = Math.max(y0 + 1, Math.floor((oy + 1) * sy));
    for (let ox = 0; ox < w; ox++) {
      const x0 = Math.floor(ox * sx);
      const x1 = Math.max(x0 + 1, Math.floor((ox + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < Math.min(y1, img.h); y++) {
        for (let x = x0; x < Math.min(x1, img.w); x++) {
          const i = (y * img.w + x) * 3;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n++;
        }
      }
      const o = (oy * w + ox) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  }
  return { w, h, data: out };
}
