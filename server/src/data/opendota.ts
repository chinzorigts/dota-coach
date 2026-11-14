// OpenDota: 영웅별 아이템 인기도(실제 매치 통계). 사용자 PC 에서 호출되며 결과는 디스크에 24시간 캐시한다.
// 실패하면 null — 엔진은 역할 기반 기본 빌드로 떨어진다.
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { getItem, itemKeyById } from "./constants.js";

export interface ItemPopularity {
  start: string[];
  early: string[];
  mid: string[];
  late: string[];
}

const TTL_MS = 24 * 60 * 60 * 1000;
const memo = new Map<number, Promise<ItemPopularity | null>>();

function rank(bucket: Record<string, number> | undefined): string[] {
  return Object.entries(bucket ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => itemKeyById(id))
    .filter((k): k is string => Boolean(k && getItem(k)));
}

export function parsePopularity(raw: unknown): ItemPopularity {
  const r = (raw ?? {}) as Record<string, Record<string, number>>;
  return {
    start: rank(r.start_game_items),
    early: rank(r.early_game_items),
    mid: rank(r.mid_game_items),
    late: rank(r.late_game_items),
  };
}

async function load(heroId: number): Promise<ItemPopularity | null> {
  const file = path.join(config.cacheDir, `popularity-${heroId}.json`);
  try {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs < TTL_MS) {
      return parsePopularity(JSON.parse(await fs.readFile(file, "utf8")));
    }
  } catch {
    /* 캐시 없음 */
  }
  try {
    const res = await fetch(`${config.opendotaBase}/heroes/${heroId}/itemPopularity`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    await fs.mkdir(config.cacheDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(raw));
    return parsePopularity(raw);
  } catch (err) {
    console.warn(`[opendota] hero ${heroId} 인기 아이템 조회 실패 — 기본 빌드 사용:`, (err as Error).message);
    return null;
  }
}

export function getItemPopularity(heroId: number): Promise<ItemPopularity | null> {
  let p = memo.get(heroId);
  if (!p) {
    p = load(heroId);
    memo.set(heroId, p);
    // 실패는 다음 번에 다시 시도할 수 있게 메모에서 뺀다
    p.then((v) => v === null && memo.delete(heroId));
  }
  return p;
}
