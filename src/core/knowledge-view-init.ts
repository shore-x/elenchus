// Elenchus - Knowledge View Initialization
// Bootstraps default knowledge-space files in the workspace root (runDirectory)
// if they do not already exist. Called once at session startup.
// This is analogous to how .elenchus/ is created for persistence state.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ROOT_AGENT_MD, DEFAULT_SKILLS_AGENT_MD } from "./knowledge-view-defaults.js";

function renderTemplate(template: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return template.replace(/\{\{DATE\}\}/g, date);
}

export function initializeKnowledgeView(runDirectory: string): void {
  const rootAgentMdPath = join(runDirectory, "AGENT.md");
  if (!existsSync(rootAgentMdPath)) {
    writeFileSync(rootAgentMdPath, renderTemplate(DEFAULT_ROOT_AGENT_MD), "utf-8");
  }

  const skillsDir = join(runDirectory, "skills");
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }

  const skillsAgentMdPath = join(skillsDir, "AGENT.md");
  if (!existsSync(skillsAgentMdPath)) {
    writeFileSync(skillsAgentMdPath, renderTemplate(DEFAULT_SKILLS_AGENT_MD), "utf-8");
  }
}
