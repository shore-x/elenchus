// Elenchus - Knowledge View Defaults
// Default template content for knowledge-space bootstrap files.
// These are written to the workspace root (runDirectory) on first startup
// if the corresponding files do not already exist.
// The workspace root is the CLI working directory, not the Elenchus source directory.
// Agents are expected to maintain and evolve these files over time.

export const DEFAULT_ROOT_AGENT_MD = `# Workspace

This is the root knowledge entry page for the current workspace.

Updated: {{DATE}}

## Overview

This workspace was initialized with the Elenchus knowledge-view convention. The root AGENT.md (this file) provides top-level orientation for agents working in this directory.

Update this file to describe the actual contents, purpose, and structure of the workspace as you learn more about it.

## Directory Index

- \`skills/\` — Actionable knowledge regions for reusable task guidance. See \`skills/AGENT.md\` for conventions.

## Notes

- AGENT.md files in subdirectories provide local orientation for their respective areas.
- Knowledge organization (creating/updating AGENT.md, organizing skills) stays within this workspace root.
- You may read and write files anywhere on the host system as tasks require, but this directory is your knowledge space.
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
