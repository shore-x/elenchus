// Elenchus - DeliberationUnit
// Compatibility wrapper over the new layered core implementation.

import { cwd } from "node:process";
import { type Model } from "@mariozechner/pi-ai";
import { PiAiLlmClient } from "./adapters/llm/pi-ai-client.js";
import { LocalNodeToolExecutor } from "./adapters/tools/local-node-tool-executor.js";
import { DeliberationUnit as CoreDeliberationUnit } from "./core/unit/deliberation-unit.js";
import { type OnSystemEvent, type ToolLevel } from "./types.js";

export interface DeliberationUnitOptions {
  model: Model<any>;
  level?: ToolLevel;
  path?: number[];
  onSystemEvent?: OnSystemEvent;
}

export class DeliberationUnit extends CoreDeliberationUnit {
  constructor(options: DeliberationUnitOptions) {
    super({
      llmClient: new PiAiLlmClient(options.model),
      toolExecutor: new LocalNodeToolExecutor(),
      workspaceRoot: cwd(),
      level: options.level,
      path: options.path,
      onSystemEvent: options.onSystemEvent,
    });
  }
}
