// Elenchus - Knowledge View Initialization
// Bootstraps default knowledge-space files in the workspaceRoot
// if they do not already exist. Called once at session startup.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ROOT_AGENT_MD } from "./knowledge-view-defaults.js";

function renderTemplate(template: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return template.replace(/\{\{DATE\}\}/g, date);
}

export function initializeKnowledgeView(workspaceRoot: string): void {
  // Ensure workspaceRoot directory exists
  mkdirSync(workspaceRoot, { recursive: true });

  // WorkspaceRoot AGENT.md (navigation hub)
  const agentMdPath = join(workspaceRoot, "AGENT.md");
  if (!existsSync(agentMdPath)) {
    writeFileSync(agentMdPath, renderTemplate(DEFAULT_ROOT_AGENT_MD), "utf-8");
  }

  // Framework state directory
  const stateDir = join(workspaceRoot, ".elenchus-state");
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
}
