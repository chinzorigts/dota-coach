export const CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react";

export const itemImg = (key: string) => `${CDN}/items/${key}.png`;
export const heroIcon = (npc: string) => `${CDN}/heroes/icons/${npc.replace("npc_dota_hero_", "")}.png`;
export const abilityImg = (key: string) => `${CDN}/abilities/${key}.png`;

export function clock(sec: number) {
  const sign = sec < 0 ? "-" : "";
  const a = Math.abs(Math.floor(sec));
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}

export const gold = (n: number) => n.toLocaleString("en-US");

export function prettyKey(key: string) {
  return key.replace(/^[a-z]+_/, "").replace(/_/g, " ");
}
