# Skills

This directory is the recommended location for storing actionable knowledge regions — organized collections of guidance, scripts, templates, and reference materials that help agents accomplish specific classes of tasks.

Updated: 2026-04-15

## Conventions

Each skill should live in its own subdirectory under `skills/`. A skill directory may contain:

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
