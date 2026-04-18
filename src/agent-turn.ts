// Elenchus - AgentTurn
// Compatibility wrapper over the new layered core implementation.

import { homedir } from "node:os";
import { join } from "node:path";
import { type Model } from "@mariozechner/pi-ai";
import { PiAiLlmClient } from "./adapters/llm/pi-ai-client.js";
import { AgentTurn as CoreAgentTurn } from "./core/unit/agent-turn.js";
import { type AgentId, type ToolLevel } from "./types.js";

export class AgentTurn extends CoreAgentTurn {
  constructor(selfId: AgentId, systemPrompt: string, model: Model<any>, level: ToolLevel = "L0") {
    const workspaceRoot = join(homedir(), "Elenchus");
    super(selfId, new PiAiLlmClient(model), level, workspaceRoot);
  }
}
