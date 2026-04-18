// Elenchus - Knowledge View Initialization
// Bootstraps default knowledge-space files in the global root and project root
// if they do not already exist. Called once at session startup.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ROOT_AGENT_MD, DEFAULT_SKILLS_AGENT_MD } from "./knowledge-view-defaults.js";

function renderTemplate(template: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return template.replace(/\{\{DATE\}\}/g, date);
}

export function initializeKnowledgeView(globalRoot: string, projectRoot: string): void {
  // Ensure global root directory exists
  mkdirSync(globalRoot, { recursive: true });

  // Global AGENT.md
  const globalAgentMdPath = join(globalRoot, "AGENT.md");
  if (!existsSync(globalAgentMdPath)) {
    writeFileSync(globalAgentMdPath, renderTemplate(DEFAULT_ROOT_AGENT_MD), "utf-8");
  }

  // Global knowledge directory
  const knowledgeDir = join(globalRoot, "knowledge");
  if (!existsSync(knowledgeDir)) {
    mkdirSync(knowledgeDir, { recursive: true });
  }

  // Project AGENT.md (only if not already present)
  const projectAgentMdPath = join(projectRoot, "AGENT.md");
  if (!existsSync(projectAgentMdPath)) {
    writeFileSync(projectAgentMdPath, renderTemplate(DEFAULT_ROOT_AGENT_MD), "utf-8");
  }
}
