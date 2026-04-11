// Elenchus - Blocking Tool Executor
// Compatibility wrapper over the new layered tool executor adapter.

import { LocalNodeToolExecutor } from "./adapters/tools/local-node-tool-executor.js";

export type { ToolExecutionResult } from "./core/ports.js";

const toolExecutor = new LocalNodeToolExecutor();

export async function executeBlockingTool(
  toolName: string,
  args: Record<string, unknown>,
) {
  return toolExecutor.execute(toolName, args);
}
