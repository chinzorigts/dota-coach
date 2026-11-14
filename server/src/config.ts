import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, "../..");

// .env lives at the repo root. Missing is fine.
try {
  process.loadEnvFile(path.join(ROOT_DIR, ".env"));
} catch {
  /* no .env */
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

function effortFromEnv(v: string | undefined): Effort {
  return EFFORTS.includes(v as Effort) ? (v as Effort) : "low";
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "127.0.0.1",
  gsiToken: process.env.GSI_TOKEN ?? "dota-coach-local",
  model: process.env.COACH_MODEL ?? "claude-opus-5-5",
  // In-game advice must be fast, so low is the default. Raise it for deeper analysis.
  effort: effortFromEnv(process.env.COACH_EFFORT),
  aiEnabled:
    Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) &&
    process.env.COACH_AI !== "off",
  aiMinIntervalSec: Number(process.env.COACH_AI_MIN_INTERVAL ?? 90),
  opendotaBase: process.env.OPENDOTA_BASE ?? "https://api.opendota.com/api",
  cacheDir: path.join(ROOT_DIR, ".cache"),
  webDist: path.join(ROOT_DIR, "web", "dist"),
};
