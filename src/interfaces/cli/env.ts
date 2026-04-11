// Elenchus - CLI Environment Parsing
// Parses CLI runtime configuration from environment variables.

import type { ToolLevel } from "../../core/types.js";

export interface CliConfig {
  provider: string;
  modelName: string;
  baseUrl?: string;
  level: ToolLevel;
  verbose: number;
}

function parseLevel(rawLevel: string): ToolLevel {
  const level = rawLevel.toUpperCase() as ToolLevel;
  if (level !== "L0" && level !== "L1" && level !== "L2") {
    throw new Error(`Invalid ELENCHUS_LEVEL: ${level}. Must be L0, L1, or L2.`);
  }
  return level;
}

export function readCliConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  return {
    provider: env.ELENCHUS_PROVIDER ?? "anthropic",
    modelName: env.ELENCHUS_MODEL ?? "claude-sonnet-4-20250514",
    baseUrl: env.ELENCHUS_BASE_URL ?? env.ANTHROPIC_BASE_URL,
    level: parseLevel(env.ELENCHUS_LEVEL ?? "L0"),
    verbose: Math.min(2, Math.max(0, parseInt(env.ELENCHUS_VERBOSE ?? "1", 10) || 0)),
  };
}
