// Elenchus - Local Node Tool Executor
// Executes approved blocking tools (Bash, ReadFile, WriteFile) in the local Node environment.

import { exec } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolExecutionResult, ToolExecutor } from "../../core/ports.js";

const BASH_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 50_000;

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

  async execute(toolName: string, args: Record<string, unknown>, options?: { cwd?: string }): Promise<ToolExecutionResult> {
    const start = Date.now();
    let result: { success: boolean; output: string };
    switch (toolName) {
      case "bash":
        result = await executeBash(args.command as string, options?.cwd);
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
