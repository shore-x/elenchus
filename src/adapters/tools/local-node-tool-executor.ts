// Elenchus - Local Node Tool Executor
// Executes approved blocking tools (Bash, ReadFile, WriteFile) in the local Node environment.
// At L0, bash commands are restricted to an information-gathering whitelist as a hard constraint.

import { exec } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolExecutionResult, ToolExecutor } from "../../core/ports.js";

const BASH_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 50_000;

// L0 bash command whitelist — information-gathering commands only.
// Commands are matched by extracting the first token (before any space/pipe/redirect).
const L0_ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  "ls", "find", "tree", "cat", "head", "tail", "grep", "wc",
  "du", "file", "stat", "pwd", "which", "echo", "diff",
  "sort", "uniq", "type", "less", "more", "printenv", "env",
  "date", "uname", "hostname", "whoami", "id",
]);

const L0_REJECTION_MESSAGE =
  "L0 hard constraint: this command is not in the information-gathering whitelist. " +
  "As the top-level coordinator, delegate task execution to a child unit using spawnChild. " +
  "Your bash access is for surveying and inspecting — not for doing the work yourself.";

function extractFirstCommand(input: string): string {
  // Strip leading whitespace, then take the first token before space/pipe/redirect/semicolon
  const trimmed = input.trimStart();
  const match = trimmed.match(/^([^\s|;&><]+)/);
  return match ? match[1] : "";
}

function isL0BashAllowed(command: string): boolean {
  const first = extractFirstCommand(command);
  // Also handle path-qualified commands like /usr/bin/ls or ./node_modules/.bin/tsc
  const basename = first.includes("/") ? first.split("/").pop()! : first;
  return L0_ALLOWED_COMMANDS.has(basename);
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return (
    output.slice(0, MAX_OUTPUT_CHARS) +
    `\n\n[Output truncated: ${output.length} chars total, showing first ${MAX_OUTPUT_CHARS}]`
  );
}

async function executeBash(command: string, cwd?: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: BASH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
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

export class LocalNodeToolExecutor implements ToolExecutor {

  async execute(toolName: string, args: Record<string, unknown>, options?: { cwd?: string; level?: string }): Promise<ToolExecutionResult> {
    const start = Date.now();
    let result: { success: boolean; output: string };
    switch (toolName) {
      case "bash":
        if (options?.level === "L0" && !isL0BashAllowed(args.command as string)) {
          result = { success: false, output: L0_REJECTION_MESSAGE };
        } else {
          result = await executeBash(args.command as string, options?.cwd);
        }
        break;
      case "readFile":
        result = await executeReadFile(args.path as string);
        break;
      case "writeFile":
        result = await executeWriteFile(args.path as string, args.content as string);
        break;
      default:
        result = { success: false, output: `Unknown blocking tool: ${toolName}` };
    }
    return { ...result, durationMs: Date.now() - start };
  }
}
