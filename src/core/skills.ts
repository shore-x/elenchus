import { getBuiltInToolList, getBuiltInTools, type ElenchusTool } from "./tools.js";
import type { ToolLevel } from "./types.js";

const DEFAULT_SKILL_LEVELS: readonly ToolLevel[] = ["L1", "L2"];
const PROPOSED_STEP_PROPERTY = {
  type: "string",
  description:
    "A short statement of how this action advances the task. Describe the task-advancing meaning of this step, not a restatement of the tool arguments.",
};

export interface SkillCommandRunner {
  type: "command";
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface InstalledSkillTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  runner: SkillCommandRunner;
}

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  version: string;
  appliesToLevels: readonly ToolLevel[];
  promptAppendix: string;
  sourcePath: string;
  contentHash: string;
  tools: readonly InstalledSkillTool[];
}

export interface SkillBindingRecord {
  skillId: string;
  version: string;
  contentHash: string;
  sourcePath: string;
  appliesToLevels: readonly ToolLevel[];
}

export interface ResolvedTool extends ElenchusTool {
  origin: "built-in" | "skill";
  skillId?: string;
  skillVersion?: string;
  sourcePath?: string;
  runner?: SkillCommandRunner;
}

function cloneSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

function withProposedStep(parameters: Record<string, unknown>): Record<string, unknown> {
  const schema = cloneSchema(parameters ?? { type: "object" });
  const properties = typeof schema.properties === "object" && schema.properties !== null
    ? { ...(schema.properties as Record<string, unknown>) }
    : {};
  properties.proposedStep = PROPOSED_STEP_PROPERTY;

  const required = Array.isArray(schema.required)
    ? [...schema.required.filter((entry): entry is string => typeof entry === "string")]
    : [];
  if (!required.includes("proposedStep")) {
    required.push("proposedStep");
  }

  return {
    ...schema,
    type: "object",
    properties,
    required,
    additionalProperties: schema.additionalProperties ?? false,
  };
}

function buildSkillToolName(skillId: string, toolName: string): string {
  return `skill.${skillId}.${toolName}`;
}

function levelsEqual(left: readonly ToolLevel[], right: readonly ToolLevel[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((level, index) => level === right[index]);
}

function formatSkillAppendix(skill: InstalledSkill): string {
  const toolNames = skill.tools.map((tool) => `\`${buildSkillToolName(skill.id, tool.name)}\``).join(", ");
  const appendix = skill.promptAppendix.trim();
  return [
    `### ${skill.name}`,
    `${skill.description}`,
    toolNames ? `Available tools: ${toolNames}` : "Available tools: none",
    appendix,
  ].filter(Boolean).join("\n\n");
}

export function compareSkillBindings(
  persisted: readonly SkillBindingRecord[],
  current: readonly SkillBindingRecord[],
): string[] {
  const persistedMap = new Map(persisted.map((binding) => [binding.skillId, binding]));
  const currentMap = new Map(current.map((binding) => [binding.skillId, binding]));
  const warnings: string[] = [];

  for (const [skillId, binding] of persistedMap.entries()) {
    const currentBinding = currentMap.get(skillId);
    if (!currentBinding) {
      warnings.push(`Skill binding mismatch on cold start: previously persisted skill ${skillId} is no longer installed.`);
      continue;
    }

    if (binding.version !== currentBinding.version) {
      warnings.push(`Skill binding mismatch on cold start: skill ${skillId} changed version from ${binding.version} to ${currentBinding.version}.`);
    }
    if (binding.contentHash !== currentBinding.contentHash) {
      warnings.push(`Skill binding mismatch on cold start: skill ${skillId} content changed since the persisted session snapshot was written.`);
    }
    if (!levelsEqual(binding.appliesToLevels, currentBinding.appliesToLevels)) {
      warnings.push(`Skill binding mismatch on cold start: skill ${skillId} changed layer visibility from [${binding.appliesToLevels.join(", ")}] to [${currentBinding.appliesToLevels.join(", ")}].`);
    }
  }

  for (const [skillId] of currentMap.entries()) {
    if (!persistedMap.has(skillId)) {
      warnings.push(`Skill binding mismatch on cold start: newly installed skill ${skillId} was not part of the persisted session capability set.`);
    }
  }

  return warnings;
}

export class CapabilityBundle {
  private readonly registry: ReadonlyMap<string, ResolvedTool>;
  private readonly skillTools: readonly ResolvedTool[];

  constructor(private readonly skills: readonly InstalledSkill[] = []) {
    const builtInTools: ResolvedTool[] = getBuiltInTools().map((tool) => ({
      ...tool,
      origin: "built-in",
    }));
    const skillTools = skills.flatMap((skill) => skill.tools.map<ResolvedTool>((tool) => ({
      name: buildSkillToolName(skill.id, tool.name),
      description: tool.description,
      parameters: withProposedStep(tool.parameters),
      category: "environment",
      behavior: "blocking",
      appliesToLevels: skill.appliesToLevels,
      origin: "skill",
      skillId: skill.id,
      skillVersion: skill.version,
      sourcePath: skill.sourcePath,
      runner: tool.runner,
    })));

    this.skillTools = skillTools;
    this.registry = new Map([...builtInTools, ...skillTools].map((tool) => [tool.name, tool]));
  }

  getToolsForTurn(hasPendingProposal: boolean, level: ToolLevel, hasChildren: boolean = false): ResolvedTool[] {
    const builtInTools = getBuiltInToolList(hasPendingProposal, level, hasChildren).map((tool) => ({
      ...tool,
      origin: "built-in" as const,
    }));
    const skillTools = this.skillTools.filter((tool) => tool.appliesToLevels.includes(level));
    return [...builtInTools, ...skillTools];
  }

  resolveTool(toolName: string): ResolvedTool | null {
    return this.registry.get(toolName) ?? null;
  }

  buildSkillPromptAppendix(level: ToolLevel): string {
    if (level === "L0") {
      return "";
    }

    const applicableSkills = this.skills.filter((skill) => skill.appliesToLevels.includes(level));
    if (applicableSkills.length === 0) {
      return "";
    }

    return [
      "",
      "## Installed Skills",
      ...applicableSkills.map(formatSkillAppendix),
    ].join("\n\n");
  }

  getSkillBindings(): SkillBindingRecord[] {
    return this.skills.map((skill) => ({
      skillId: skill.id,
      version: skill.version,
      contentHash: skill.contentHash,
      sourcePath: skill.sourcePath,
      appliesToLevels: skill.appliesToLevels,
    }));
  }
}

export function createCapabilityBundle(skills: readonly InstalledSkill[] = []): CapabilityBundle {
  return new CapabilityBundle(skills);
}

export function getDefaultSkillLevels(): readonly ToolLevel[] {
  return DEFAULT_SKILL_LEVELS;
}
