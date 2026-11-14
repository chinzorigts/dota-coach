// Downloads every hero portrait once (Steam CDN, cached on disk) and builds the template bank.
import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { config } from "../config.js";
import { allHeroes } from "../data/constants.js";
import { fromRGBA } from "./image.js";
import { TemplateBank } from "./matcher.js";

const dir = () => path.join(config.cacheDir, "heroes");

async function loadPortrait(name: string, url: string): Promise<Buffer> {
  const file = path.join(dir(), `${name}.png`);
  try {
    return await fs.readFile(file);
  } catch {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(dir(), { recursive: true });
    await fs.writeFile(file, buf);
    return buf;
  }
}

export interface BankStatus {
  loaded: number;
  total: number;
  failed: number;
}

let bankPromise: Promise<{ bank: TemplateBank; status: BankStatus }> | null = null;

export function getTemplateBank(): Promise<{ bank: TemplateBank; status: BankStatus }> {
  if (!bankPromise) {
    bankPromise = (async () => {
      const heroes = allHeroes();
      const bank = new TemplateBank();
      let failed = 0;
      // Small batches: polite to the CDN, and the first run finishes in a few seconds
      for (let i = 0; i < heroes.length; i += 8) {
        await Promise.all(
          heroes.slice(i, i + 8).map(async (h) => {
            try {
              const png = PNG.sync.read(await loadPortrait(h.name, h.img));
              bank.add(h.name, fromRGBA(png.width, png.height, png.data));
            } catch {
              failed++;
            }
          }),
        );
      }
      const status = { loaded: bank.size, total: heroes.length, failed };
      if (failed) console.warn(`[vision] ${failed}/${heroes.length} hero portraits failed to load`);
      // Nothing loaded (offline): allow a retry on the next request
      if (bank.size === 0) bankPromise = null;
      return { bank, status };
    })();
  }
  return bankPromise;
}
