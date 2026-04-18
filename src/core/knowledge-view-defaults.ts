// Elenchus - Knowledge View Defaults
// Default template content for knowledge-space bootstrap files.
// These are written to the workspaceRoot on first startup
// if the corresponding files do not already exist.
// The workspaceRoot is the agent's working world root (default ~/Elenchus/).
// Agents are expected to maintain and evolve these files over time.

export const DEFAULT_ROOT_AGENT_MD = `# Workspace

This is the navigation hub for the Elenchus agent's working world.

Updated: {{DATE}}

## Overview

This workspace was initialized with the Elenchus knowledge-view convention. This AGENT.md serves as the navigation hub — it indexes active projects and provides cross-project context for coordination.

Update this file to describe the actual contents, purpose, and structure of the workspace as you learn more about it.

## Active Projects

- (List active project directories here as they are discovered)

## Notes

- Knowledge has a single destination: where the work naturally belongs. Write knowledge at meaningful locations in the project structure, not here.
- This file is the only AGENT.md injected into every agent's system prompt. Keep it concise — overview and navigation only.
- AGENT.md files in project directories provide local orientation. Agents discover them through this navigation hub or via report messages with absolute paths.
`;

export const DEFAULT_SKILLS_AGENT_MD = `# Skills

This directory is the recommended location for storing actionable knowledge regions — organized collections of guidance, scripts, templates, and reference materials that help agents accomplish specific classes of tasks.

Updated: {{DATE}}

## Conventions

Each skill should live in its own subdirectory under \`skills/\`. A skill directory may contain:

- Explanatory text describing the task domain and approach
- Scripts or code that the agent can invoke via bash or other environment tools
- Templates, reference materials, or example artifacts
- An AGENT.md providing local orientation for the skill region

## Adapting External Skills

Skills from other agent frameworks should not be imported verbatim. Instead, rewrite them to fit the knowledge-view model:

- Replace structured manifests (JSON, YAML) with natural-language AGENT.md entry pages
- Convert tool registration metadata into guidance text that helps the agent use existing environment tools (bash, readFile, writeFile) to achieve the same outcomes
- Preserve the core actionable knowledge while removing framework-specific packaging

The goal is not to replicate another system's skill format, but to create a well-organized knowledge region that any agent in this workspace can navigate and act on.
`;
