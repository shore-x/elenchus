// Elenchus - Local Node Tool Executor
// Executes approved blocking tools (Bash, ReadFile, WriteFile) in the local Node environment.

import { exec, execFile } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ToolExecutionResult, ToolExecutor } from "../../core/ports.js";
import { createCapabilityBundle, type CapabilityBundle } from "../../core/skills.js";

const BASH_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 50_000;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return (
    output.slice(0, MAX_OUTPUT_CHARS) +
    `\n\n[Output truncated: ${output.length} chars total, showing first ${MAX_OUTPUT_CHARS}]`
  );
}

async function executeBash(command: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    exec(command, { timeout: BASH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (error && !combined) {
        resolve({
          success: false,
          output: `Command failed: ${error.message}`,
        });
      } else {
        resolve({
          success: !error,
          output: truncateOutput(combined || "(no output)"),
        });
      }
    });
  });
}

async function executeReadFile(path: string): Promise<{ success: boolean; output: string }> {
  try {
    const content = await readFile(path, "utf-8");
    return { success: true, output: truncateOutput(content) };
  } catch (err: any) {
    return { success: false, output: `Failed to read file: ${err.message}` };
  }
}

async function executeWriteFile(path: string, content: string): Promise<{ success: boolean; output: string }> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf-8");
    return { success: true, output: `File written successfully: ${path} (${content.length} chars)` };
  } catch (err: any) {
    return { success: false, output: `Failed to write file: ${err.message}` };
  }
}

function interpolateTemplate(template: string, args: Record<string, unknown>, skillDir: string): string {
  return template.replace(/\{\{\s*(skillDir|arg\.[a-zA-Z0-9_]+)\s*\}\}/g, (_match, token: string) => {
    if (token === "skillDir") {
      return skillDir;
    }
    const argName = token.slice("arg.".length);
    const value = args[argName];
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return JSON.stringify(value);
  });
}

function resolveCommand(command: string, skillDir: string): string {
  if (isAbsolute(command)) {
    return command;
  }
  if (command.includes("/") || command.startsWith(".")) {
    return resolve(skillDir, command);
  }
  return command;
}

async function executeSkillCommand(
  capabilities: CapabilityBundle,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ success: boolean; output: string }> {
  const tool = capabilities.resolveTool(toolName);
  if (!tool || tool.origin !== "skill" || !tool.runner || !tool.sourcePath) {
    return { success: false, output: `Unknown blocking skill tool: ${toolName}` };
  }

  const skillDir = tool.sourcePath;
  const command = resolveCommand(interpolateTemplate(tool.runner.command, args, skillDir), skillDir);
  const commandArgs = (tool.runner.args ?? []).map((entry) => interpolateTemplate(entry, args, skillDir));
  const cwd = tool.runner.cwd ? resolve(skillDir, interpolateTemplate(tool.runner.cwd, args, skillDir)) : skillDir;
  const timeout = tool.runner.timeoutMs ?? BASH_TIMEOUT_MS;

  return new Promise((resolvePromise) => {
    execFile(command, commandArgs, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (error && !combined) {
        resolvePromise({
          success: false,
          output: `Skill command failed: ${error.message}`,
        });
      } else {
        resolvePromise({
          success: !error,
          output: truncateOutput(combined || "(no output)"),
        });
      }
    });
  });
}

export class LocalNodeToolExecutor implements ToolExecutor {
  constructor(private readonly capabilities: CapabilityBundle = createCapabilityBundle()) {}

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const start = Date.now();
    let result: { success: boolean; output: string };
    switch (toolName) {
      case "bash":
        result = await executeBash(args.command as string);
        break;
      case "readFile":
        result = await executeReadFile(args.path as string);
        break;
      case "writeFile":
        result = await executeWriteFile(args.path as string, args.content as string);
        break;
      default:
        result = toolName.startsWith("skill.")
          ? await executeSkillCommand(this.capabilities, toolName, args)
          : { success: false, output: `Unknown blocking tool: ${toolName}` };
    }
    return { ...result, durationMs: Date.now() - start };
  }
}
