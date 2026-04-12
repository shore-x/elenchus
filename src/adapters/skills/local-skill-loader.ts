import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDefaultSkillLevels, type InstalledSkill, type InstalledSkillTool, type SkillCommandRunner } from "../../core/skills.js";
import type { ToolLevel } from "../../core/types.js";

interface RawSkillManifestTool {
  name?: unknown;
  description?: unknown;
  parameters?: unknown;
  runner?: unknown;
}

interface RawSkillManifest {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  version?: unknown;
  appliesToLayers?: unknown;
  tools?: unknown;
}

function isToolLevel(value: string): value is ToolLevel {
  return value === "L0" || value === "L1" || value === "L2";
}

function normalizeLayers(rawLayers: unknown, skillId: string): readonly ToolLevel[] {
  if (rawLayers === undefined) {
    return getDefaultSkillLevels();
  }
  if (!Array.isArray(rawLayers) || rawLayers.some((entry) => typeof entry !== "string" || !isToolLevel(entry))) {
    throw new Error(`Skill ${skillId} has invalid appliesToLayers. Expected an array of ToolLevel strings.`);
  }
  return rawLayers as ToolLevel[];
}

function normalizeRunner(rawRunner: unknown, skillId: string, toolName: string): SkillCommandRunner {
  if (!rawRunner || typeof rawRunner !== "object") {
    throw new Error(`Skill ${skillId} tool ${toolName} is missing a runner definition.`);
  }
  const runner = rawRunner as Record<string, unknown>;
  if (runner.type !== "command") {
    throw new Error(`Skill ${skillId} tool ${toolName} has unsupported runner type ${String(runner.type)}.`);
  }
  if (typeof runner.command !== "string" || !runner.command.trim()) {
    throw new Error(`Skill ${skillId} tool ${toolName} must specify a non-empty runner.command.`);
  }
  if (runner.args !== undefined && (!Array.isArray(runner.args) || runner.args.some((entry) => typeof entry !== "string"))) {
    throw new Error(`Skill ${skillId} tool ${toolName} has invalid runner.args. Expected an array of strings.`);
  }
  if (runner.cwd !== undefined && typeof runner.cwd !== "string") {
    throw new Error(`Skill ${skillId} tool ${toolName} has invalid runner.cwd. Expected a string.`);
  }
  if (runner.timeoutMs !== undefined && (typeof runner.timeoutMs !== "number" || !Number.isFinite(runner.timeoutMs) || runner.timeoutMs <= 0)) {
    throw new Error(`Skill ${skillId} tool ${toolName} has invalid runner.timeoutMs. Expected a positive number.`);
  }

  return {
    type: "command",
    command: runner.command,
    args: (runner.args as string[] | undefined) ?? [],
    cwd: runner.cwd as string | undefined,
    timeoutMs: runner.timeoutMs as number | undefined,
  };
}

function normalizeTool(rawTool: RawSkillManifestTool, skillId: string): InstalledSkillTool {
  if (typeof rawTool.name !== "string" || !rawTool.name.trim()) {
    throw new Error(`Skill ${skillId} contains a tool without a valid name.`);
  }
  if (typeof rawTool.description !== "string" || !rawTool.description.trim()) {
    throw new Error(`Skill ${skillId} tool ${rawTool.name} is missing a valid description.`);
  }
  if (!rawTool.parameters || typeof rawTool.parameters !== "object" || Array.isArray(rawTool.parameters)) {
    throw new Error(`Skill ${skillId} tool ${rawTool.name} must provide an object-valued parameters schema.`);
  }

  return {
    name: rawTool.name,
    description: rawTool.description,
    parameters: rawTool.parameters as Record<string, unknown>,
    runner: normalizeRunner(rawTool.runner, skillId, rawTool.name),
  };
}

function computeContentHash(manifestRaw: string, promptAppendix: string): string {
  return createHash("sha256")
    .update(manifestRaw)
    .update("\n---\n")
    .update(promptAppendix)
    .digest("hex");
}

export interface LocalSkillLoaderOptions {
  runDirectory: string;
  skillsDirectoryName?: string;
}

export class LocalSkillLoader {
  private readonly skillsRoot: string;

  constructor(options: LocalSkillLoaderOptions) {
    this.skillsRoot = join(options.runDirectory, options.skillsDirectoryName ?? "skills");
  }

  getSkillsRoot(): string {
    return this.skillsRoot;
  }

  loadInstalledSkills(): InstalledSkill[] {
    if (!existsSync(this.skillsRoot)) {
      return [];
    }

    return readdirSync(this.skillsRoot)
      .map((entry) => join(this.skillsRoot, entry))
      .filter((entryPath) => statSync(entryPath).isDirectory())
      .map((skillDir) => this.loadSkillFromDirectory(skillDir));
  }

  loadSkillFromDirectory(skillDir: string): InstalledSkill {
    return this.loadSkill(skillDir);
  }

  private loadSkill(skillDir: string): InstalledSkill {
    const manifestPath = join(skillDir, "skill.json");
    const promptPath = join(skillDir, "SKILL.md");
    if (!existsSync(manifestPath)) {
      throw new Error(`Skill directory ${skillDir} is missing required file skill.json.`);
    }
    if (!existsSync(promptPath)) {
      throw new Error(`Skill directory ${skillDir} is missing required file SKILL.md.`);
    }

    const manifestRaw = readFileSync(manifestPath, "utf-8");
    const promptAppendix = readFileSync(promptPath, "utf-8").trim();
    const manifest = JSON.parse(manifestRaw) as RawSkillManifest;

    if (typeof manifest.id !== "string" || !manifest.id.trim()) {
      throw new Error(`Skill manifest at ${manifestPath} is missing a valid id.`);
    }
    if (typeof manifest.name !== "string" || !manifest.name.trim()) {
      throw new Error(`Skill ${manifest.id} is missing a valid name.`);
    }
    if (typeof manifest.description !== "string" || !manifest.description.trim()) {
      throw new Error(`Skill ${manifest.id} is missing a valid description.`);
    }
    if (typeof manifest.version !== "string" || !manifest.version.trim()) {
      throw new Error(`Skill ${manifest.id} is missing a valid version.`);
    }
    if (!Array.isArray(manifest.tools)) {
      throw new Error(`Skill ${manifest.id} must declare tools as an array.`);
    }

    const tools = manifest.tools.map((tool) => normalizeTool(tool as RawSkillManifestTool, manifest.id as string));
    return {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      appliesToLevels: normalizeLayers(manifest.appliesToLayers, manifest.id),
      promptAppendix,
      sourcePath: resolve(skillDir),
      contentHash: computeContentHash(manifestRaw, promptAppendix),
      tools,
    };
  }
}
