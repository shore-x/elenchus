---
title: "Elenchus Framework Design - Knowledge View"
date: 2026-04-15
version: 4.0
---

# Knowledge View

> **Synchronization note**
> - Changes here may require reviewing `framework-design.md` / §2.4, §4.3, §5.3.
> - Changes in `framework-design.md` may require reviewing this file.

## Scope

- Why Elenchus unifies skill and memory into a single knowledge view
- Storage model: file system as substrate, AGENT.md as local entry page
- What AGENT.md is and is not
- Structural conventions (soft, not enforced)
- Coverage and referencing principles
- How "skill" is reabsorbed
- Global and project knowledge space model (two-root architecture)
- Dual-channel communication: knowledge channel design
- What is deliberately excluded

Complements: [conversation-model.md](./conversation-model.md), [hierarchy-and-layers.md](./hierarchy-and-layers.md), [state-machine-and-tools.md](./state-machine-and-tools.md).

Relevant overview: `framework-design.md` §2.4, §4.3, §5.3; Principles P2, P9, P10, P27, P28.

---

## 0. Relation to the Former Skill System

The v1 installable-skill model — structured manifest, prompt appendix, namespaced tool registration, capability-provider hot install — was a legitimate engineering stage. Its code has been fully removed: `skills.ts`, `CapabilityBundle`, `CapabilityProvider`, `installSkill` tool, skill binding persistence, and the `adapters/skills/` directory no longer exist.

Core shift:

- **Old**: skill is an installable capability bundle, a separate object category.
- **New**: skill is reabsorbed as an organizational result of well-organized actionable knowledge within the file system.

---

## 1. Foundational Position

### 1.1 File system as unified substrate

Knowledge space is not a separate storage system. The agent's original situation is the entire external file system; knowledge space is a cognitive organizational layer built on that substrate.

Skill, memory, scripts, intermediate results, downloaded materials, temporary workspace artifacts — all belong to the same external resource space. They differ in stability, lifecycle, reliability, visibility, but not in storage ontology.

### 1.2 Knowledge as cognitive view

"Knowledge" here denotes a cognitive status, not an object category: certain files are being treated as interpretable, referenceable, maintainable cognitive objects.

- File system = external resource substrate
- Knowledge space = navigable cognitive view on that substrate

### 1.3 Unification preserves differences, removes ontology division

Different contents differ in stability, lifecycle, reliability — that is acknowledged. What is denied is a priori solidifying those differences into separate system entities.

Goal: **preserve cognitive-status differences, remove storage-ontology division**.

---

## 2. AGENT.md: Role Definition

### 2.1 AGENT.md is a local knowledge entry page

AGENT.md is a **local knowledge entry page** or **semantic landing page** for a directory. Its purpose is to help the agent understand that directory at low cost:

- What this directory is for
- Which contents are core vs. secondary or temporary
- Where to start reading
- What external areas are related

### 2.2 AGENT.md is not a configuration file

AGENT.md must not be understood as:

- A directory-level manifest
- A directory-level system prompt
- A permission declaration file
- A mandatory behavior specification
- A configuration protocol that must be stably parseable

It may contain advisory descriptions, reading cues, and organizational information, but it must not become a rigid control plane over agent behavior.

### 2.3 AGENT.md is not skill in disguise

If AGENT.md is given strict schema, mandatory fields, unified registration, hard parsing dependencies, and system-level enforcement, it will slide back into exactly the kind of skill manifest this design set out to leave behind.

AGENT.md's value lies in being a **natural-language semantic entry point**, not a renamed skill registration unit.

---

## 3. Structural Principles

### 3.1 No enforced fixed structure

AGENT.md must not be required to follow a fixed structure. Different directories differ in content nature, complexity, stability, audience, and cognitive purpose; their expression should be allowed to differ.

The system may encourage common organizational habits, but must not elevate them to mandatory protocol. This avoids:

- Formalism bloat
- Metadata maintenance burden
- Agent attention diverted from cognitive validity to format compliance

### 3.2 Common shape as soft convention

A recommended common shape may exist:

- **Front section**: directory-level introduction, boundary description, key entry points, cognitive hints, update time
- **Rear section**: descriptions of important files and subdirectories, local index, cross-references

This layered shape supports progressive disclosure: the agent can read the front section first to build a directory-level model, then search or read the rear section on demand.

But this layered shape is a **soft convention**, not a precondition for system correctness.

### 3.3 Separator may exist, but must not become a protocol dependency

Using a separator (e.g., `---`) between front and rear sections is a reasonable reading-optimization strategy. It helps the agent load high-level semantics cheaply, then expand into local details on demand.

But the separator must not be:

- Required to exist
- Required to follow a uniform syntax
- Required to be stably parseable by programs
- Treated as invalid if absent

Otherwise a beneficial writing habit becomes a rigid protocol.

---

## 4. Coverage Principles

### 4.1 No full-directory coverage

AGENT.md must not be required to cover every directory in the file system. Directory-level knowledge entry pages should serve only **high-value regions worth long-term semanticization**.

Reasons:

- Many directories are not worth long-term semantic maintenance
- Low-value entry pages create maintenance burden, drift, and misleading staleness
- Agent attention should not be consumed by metadata maintenance

Direction: **acknowledge the whole file system as unified substrate in principle, but only semantically organize a subset of it with high quality**.

### 4.2 Entering the knowledge view does not require AGENT.md

A resource enters the knowledge view without AGENT.md being a necessary condition. Entry paths include:

- Being explicitly referenced by an AGENT.md
- Being marked as a key area by a parent directory's entry page
- Being repeatedly read and referenced during tasks
- Being incorporated into stable cognitive paths via summaries, indexes, or link networks

AGENT.md is a powerful entry mechanism, but not the only form of knowledge-view presence.

---

## 5. Referencing and Connectivity

### 5.1 Cross-directory referencing is allowed

AGENT.md files in different directories may reference each other. Real knowledge organization does not strictly follow the directory tree; high-value associations often cross hierarchy levels, modules, task lines, and semantic regions.

If AGENT.md can only describe "inside this directory", it provides only local orientation, not higher-quality knowledge connectivity.

### 5.2 References are cognitive edges, not system registration

Cross-directory references should not become a formal graph-database mechanism requiring central registration, unified indexing, or strong-consistency validation.

At the current stage, references are lightweight cognitive edges: pointing to related directories, indicating cross-region paths, describing functional or semantic relationships. The emphasis is on **helping navigation and understanding**, not on building a complex knowledge-graph management system.

---

## 6. Content Boundary Principles

### 6.1 Prioritize "how to understand here" over "how you must act"

Appropriate AGENT.md content helps the agent build a local world model: directory purpose, content layering, recommended entry points, core vs. secondary distinction, relationships with other directories.

It should not primarily be: behavioral constraint checklists, mandatory hard-rule sets, workflow-template forced entry points, or a local command system targeting the agent.

### 6.2 Update time: present but semantically restrained

Recording update time is reasonable for freshness gauging. But the timestamp means:

- **It means**: this entry page was last organized or reviewed at this time.
- **It does not mean**: contents have been fully verified, the description is necessarily accurate, or recent updates imply higher credibility.

Update time is a cognitive auxiliary signal, not a truth guarantee.

---

## 7. Skill Reabsorption

Under this design, traditional "skill" no longer needs to exist as an independent ontology. It can be reunderstood as:

> A well-organized knowledge region that can stably help the agent accomplish a class of tasks.

Such a knowledge region may contain: explanatory text, scripts or code, templates, reference materials, workflow clues, local entry pages and their cross-references.

"Unifying knowledge and skill" is not crudely merging them into a new object type. It is reabsorbing the capability guidance formerly carried by "skill" into the file system's knowledge organization structure.

What was a "skill" becomes a **recognizable, navigable, actionable knowledge region** — not a registered plugin with its own lifecycle.

---

## 8. Prompt Injection Design

The knowledge view is realized primarily through prompt design rather than code enforcement.

### 8.1 Workspace Root and Knowledge Space Boundary

The **workspace root** is the directory from which the Elenchus CLI is launched (`cwd()`). This directory is the root of the agent's knowledge space.

- The agent's absolute workspace root path is injected into the system prompt so the agent always knows where it is.
- **Knowledge-organization activities** — creating or updating AGENT.md files, organizing skill regions, maintaining knowledge structure — must stay within the workspace root.
- The agent may **read and write files anywhere** on the host system when a task requires it, but directories outside the workspace root are operational targets, not part of the knowledge space.
- This is a prompt-level soft constraint, not a code-level enforcement, consistent with the overall knowledge-view philosophy.

### 8.2 Knowledge View Guideline (static)

A fixed prompt section inserted into every agent's system prompt, after Layer Orientation and before Cognitive Style. It includes:

- The workspace root absolute path (dynamically substituted)
- The knowledge-view mechanism: AGENT.md as local entry page, no enforced schema, natural cognitive housekeeping
- **Writing guidance**: AGENT.md should be a quick-orientation entry point, not exhaustive documentation. Good content includes directory purpose, key entry files, brief subdirectory descriptions, relationships to other areas, and an `Updated:` timestamp. Agents should avoid putting temporary task notes, detailed implementation logic, full API documentation, or conversation logs into AGENT.md. The root AGENT.md is explicitly flagged as injected into the system prompt every turn, so agents understand its length directly reduces available context budget.
- The knowledge space boundary constraint described in §8.1
- Guidance to check for AGENT.md when exploring new directories within the workspace

This section does not reproduce the full design principles. It conveys just enough for the agent to understand and participate in the knowledge-view convention.

### 8.3 Workspace Knowledge (dynamic)

Immediately after the Knowledge View Guideline, the system prompt injects the content of two AGENT.md files:

1. **Global AGENT.md** (`~/.elenchus/AGENT.md`): cross-project knowledge, injected first.
2. **Project AGENT.md** (`<projectRoot>/AGENT.md`): project-specific knowledge, injected second.

Both are read synchronously from disk each time `buildSystemPrompt` is called, so any agent modifications take effect from the next turn.

If either AGENT.md does not exist, that section is silently omitted.

### 8.4 Resulting system prompt structure

```
GUIDELINE (collaboration protocol, dialogue norms, tool descriptions)
+ LAYER_ORIENTATION (L0/L1/L2)
+ KNOWLEDGE_VIEW_GUIDELINE (static; includes global root path, project root path, and boundary)
+ GLOBAL_KNOWLEDGE (dynamic; ~/.elenchus/AGENT.md content, read each turn)
+ PROJECT_KNOWLEDGE (dynamic; <projectRoot>/AGENT.md content, read each turn)
+ COGNITIVE_STYLE (Agent A / Agent B)
```

The former `capabilities?.buildSkillPromptAppendix()` injection point has been removed from the prompt assembly to avoid conflicting signals with the knowledge-view mechanism. The v1 skill runtime (capability provider, tool registration) remains operational for tool-surface purposes during the transition period.

### 8.5 Runtime initialization

At session startup, before creating the root deliberation unit, the framework bootstraps default knowledge-space files in two locations:

**Global root** (`~/.elenchus/`):
- `AGENT.md` — global knowledge entry page template
- `knowledge/` directory — global knowledge artifacts directory

**Project root** (`<projectRoot>/`):
- `AGENT.md` — project-level knowledge entry page template (only if not already present)

The default templates are stored as string constants in `src/core/knowledge-view-defaults.ts` and written by `src/core/knowledge-view-init.ts`. The global root and its subdirectories are created on first run; project-level files are only created if they do not already exist.

If the project AGENT.md already exists (e.g., when running from a project that ships its own `AGENT.md`), it is not overwritten. Agents are expected to maintain and evolve these files over time.

---

## 9. Global and Project Knowledge Space

### 9.1 Two-root architecture

Elenchus distinguishes two root directories, serving different purposes:

| Concept | Path | Role |
|---|---|---|
| **globalRoot** | `~/.elenchus/` | Application-level fixed directory, independent of where the CLI is launched. Stores global knowledge, cross-project experience, and session persistence. |
| **projectRoot** | `cwd()` or git root | The project being worked on. Bash cwd is set here. Agents operate on the project's actual file structure. |

The global root is fixed and stable — it exists regardless of which project the user is working on. The project root varies per session, determined by where the user launches Elenchus (or the git root detected from that location).

This design follows from the first-principles analysis in [`workspace-ownership-analysis.md`](./workspace-ownership-analysis.md), which demonstrates that per-agent workspace ownership provides only illusory isolation, and that the knowledge space should be application-level infrastructure rather than tied to the command-line launch directory.

### 9.2 Global root structure

```
~/.elenchus/                           ← globalRoot (fixed)
  AGENT.md                             ← Global knowledge entry page (cross-project)
  knowledge/                           ← Global knowledge artifacts
  projects/<project-hash>/             ← Per-project runtime state
    state.db                           ← SQLite session persistence
    AGENT.md                           ← Project-level persistent knowledge entry
```

Key properties:

- **`<project-hash>`**: a deterministic hash of the projectRoot absolute path, ensuring each project gets a unique state directory without exposing the full path in the directory name.
- **`knowledge/`**: the default location for global knowledge artifacts — methodology notes, cross-project experience, tool usage insights, reusable patterns.
- **`AGENT.md`**: the global knowledge entry page, injected into every agent's system prompt across all projects.

### 9.3 Project root as bash cwd

All agents execute bash commands with `cwd` set to the project root. There is no per-agent working directory. Agents operate on the project's actual file structure directly.

Knowledge artifacts within the project are placed at meaningful locations in the project structure. An analysis of the auth module goes to `docs/auth-analysis.md` or `src/auth/AGENT.md`, not to a private agent directory.

Agents are encouraged to write `.md` files within the project when the knowledge is project-specific. This includes work records, findings, and AGENT.md files for project directories.

### 9.4 Knowledge artifact placement

The primary knowledge artifact format is **.md files**. Agents decide where to place them based on scope:

- **Global/cross-project knowledge** → `~/.elenchus/knowledge/` (methodology, reusable patterns, tool insights)
- **Project-specific knowledge** → within the project structure (findings, module-level AGENT.md, docs)

The prompt guides this distinction but does not enforce it. The agent's context window + compression snapshot serves as the in-memory staging area; the file system is for published knowledge. If an artifact has value, it goes to a meaningful location; if it has no value, it should not be written.

There is no ontological distinction between "notes" and "work files" — both are knowledge produced during work.

### 9.5 Change tracking via project git

The project root may already be a git repository. This repository serves as the natural change tracking mechanism for project files — agents can use `git status`, `git diff`, and `git log` via bash to understand what has changed.

Key properties:

- **No per-unit git init**: the project's own git repository tracks changes. No additional git repositories are created.
- **Agent-visible**: agents use `bash` to run git commands. This is a natural use of environment tools, not a special integration point.
- **Conflict detection**: git naturally detects when multiple agents have modified the same files.
- **No enforcement**: git tracking is a convenience, not a correctness requirement.

Global knowledge files under `~/.elenchus/` are not tracked by git. They are personal configuration and knowledge, analogous to Claude Code's `~/.claude/` directory.

### 9.6 Conflict management

When multiple agents operate on the same shared file system, conflicts can occur. The framework manages this through existing coordination mechanisms rather than structural isolation:

- **L0 coordination**: L0 assigns work scope through task briefs and monitors child progress through report/yield. L0 naturally prevents overlap by delegating non-overlapping tasks.
- **Proposal-vote**: any write within a unit requires dual-agent approval, catching potentially problematic operations.
- **Git safety net**: even if conflict occurs, git provides detection and recovery.
- **Low actual concurrency**: within a unit, execution is strictly serial (FSM). Between units, L0 coordinates scheduling.

This approach makes conflict **explicit** rather than **hidden**.

### 9.7 Cross-unit knowledge sharing

Agents share knowledge through the file system. This is the primary mechanism for the **knowledge channel** in dual-channel communication (P27).

Guidelines:

- **Read on demand, not eagerly**: agents should read knowledge files only when they need specific information, not preemptively scan everything
- **Reference over copy**: when an agent needs knowledge produced by another agent, prefer reading the original file over copying it. If integration is needed, produce a new understanding rather than mirroring the original.
- **Discovery via report messages**: agents should include absolute file paths in `report`/`yield` messages so other agents know what knowledge artifacts exist and where to find them
- **Coordination via L0**: if an agent needs another agent to update or create a knowledge artifact, it should report upward to L0, which can then coordinate via `sendToChild`

## 10. Dual-Channel Knowledge Sharing

### 10.1 Knowledge channel in the communication architecture

The knowledge channel is one half of the dual-channel communication architecture (P27). It complements the message channel:

- **Message channel** (ConversationLedger): carries signals, triggers, coordination, and lightweight summaries. Push-based; arrival triggers processing.
- **Knowledge channel** (.md files in workspaces): carries detailed work products, long-term memory, and cross-turn knowledge. Pull-based; read on demand, not read = no context cost.

The two channels are complementary, not redundant:

- The message channel should not carry detailed work results (that would waste context budget)
- The knowledge channel should not carry immediate triggering responsibility (files don't trigger work; messages do)

### 10.2 Report-with-reference pattern

When a child unit completes a task phase or reaches a coordination point, the recommended pattern is:

1. **Write**: save detailed work record to a .md file in the child's workspace
2. **Report**: send `report` or `yield` with a lightweight summary + the .md file path(s)
3. **Read on demand**: parent reads the .md file only when it needs the detail

This pattern ensures that:
- The parent always receives a signal that new work has been done (via message channel)
- The parent can access full detail when needed (via knowledge channel)
- Context budget is preserved when detail is not needed

### 10.3 Knowledge integration at parent level

When a parent unit reads child workspace files and needs to incorporate that knowledge:

- The parent should produce its **own** .md file in its own workspace, containing its own understanding, synthesis, or summary
- This is not a copy of the child's file — it is the parent's interpretation, potentially combining insights from multiple children or adding context from the parent's own reasoning
- The parent's integrated knowledge file may reference the original child files for traceability

### 10.4 Discoverability considerations

The primary discoverability mechanism is the report message: when a child saves a .md file, it tells the parent where to find it. This is sufficient for the common case.

For broader discovery (e.g., parent wants to explore what a child has accumulated over time):

- The child's AGENT.md should serve as the workspace entry page, listing key knowledge artifacts
- The parent may use `bash` (ls, find, grep) to explore the child's workspace directory structure
- These are secondary mechanisms; the primary path remains report-with-reference

### 10.5 Staleness and currency

Files are static snapshots. When a child updates a .md file, the parent has no automatic notification of the change. Mitigations:

- The child should mention significant updates in `report` messages
- The parent should be aware that a file read at time T may not reflect changes made after T
- AGENT.md update timestamps provide a soft freshness signal
- For critical real-time coordination, the message channel should be used instead of the knowledge channel

---

## 11. Deliberately Excluded from Current Scope

To maintain design simplicity and principle-level stability, the following are **explicitly not included** in this document:

- AGENT.md governance flow (when/how agent creates, updates, or deletes AGENT.md)
- Synchronization between AGENT.md and actual directory contents
- Drift detection, staleness detection, and auto-repair
- Unified validators or schema verification
- Permission control, protection mechanisms, conflict-merge strategies
- Whether a global index page, root entry page, or resident entry layer is needed
- More complex knowledge-graph, scoring, or tagging designs
- How the v1 capability-provider and installSkill tool transition toward the new model

These belong to subsequent **knowledge governance / anti-entropy** problems, not to the current knowledge-view storage model.

---

## 12. Design Principles Summary

1. **Substrate principle**: Knowledge space is a cognitive view on the file system, not an independent knowledge base.
2. **Entry-page principle**: AGENT.md is a local knowledge entry page; its role is to help understand the directory, not to constrain the agent.
3. **No-rigid-schema principle**: AGENT.md has no enforced fixed structure; common shapes are soft conventions only.
4. **Progressive-disclosure principle**: AGENT.md may adopt a "directory introduction + local index" layered shape, but system correctness must not depend on it.
5. **Selective-coverage principle**: Only high-value regions worth long-term semanticization need AGENT.md; full-directory coverage is not pursued.
6. **Cross-reference principle**: AGENT.md files in different directories may reference each other to support cross-directory knowledge connectivity.
7. **Skill-reabsorption principle**: Skill no longer exists as an independent storage ontology; it is reabsorbed as an organizational result of actionable knowledge regions.
8. **Prompt-realization principle**: The knowledge view is realized through prompt injection (static guideline + dynamic root AGENT.md), not through code-level enforcement or schema validation.
9. **Knowledge-space-boundary principle**: Knowledge space has two boundaries — globalRoot (`~/.elenchus/`) and projectRoot (cwd/git root). Agents may read/write files anywhere on the host system, but knowledge-organization activities stay within these two roots.
10. **Scope-restraint principle**: Current scope is limited to the knowledge-view storage model and prompt injection; governance, anti-entropy, and auto-maintenance are deferred.
11. **Two-root-knowledge principle**: Knowledge space has two roots — globalRoot (`~/.elenchus/`) for cross-project knowledge and persistence, projectRoot (cwd/git root) for project-specific operations. The global root is fixed and independent of launch location.
12. **Knowledge-channel-complement principle**: The knowledge channel (.md files) complements the message channel (ConversationLedger); they carry different communication loads and must not substitute for each other.
13. **Reference-over-copy principle**: When an agent needs knowledge produced by another agent, prefer reading the original file over copying it; integration should produce the agent's own understanding, not a mirror.
14. **Explicit-conflict principle**: Conflict in shared space is explicit and manageable through L0 coordination + proposal-vote + git, rather than hidden through structural isolation that only provides illusory separation.
15. **No-notes-work-split principle**: There is no ontological distinction between "notes" and "work files" — both are knowledge produced during work. The in-memory context window is the staging area; the file system is for published knowledge.

---

## Change Log

- **v4.0 (2026-04-17)**: Introduce two-root architecture: globalRoot (`~/.elenchus/`) + projectRoot (cwd/git root). Global root stores cross-project knowledge (`knowledge/`), per-project state (`projects/<hash>/state.db`), and global AGENT.md. Project root is bash cwd and site for project-specific knowledge artifacts. Prompt injection now includes both global and project AGENT.md. Session persistence moved from `<projectRoot>/.elenchus/state.db` to `~/.elenchus/projects/<hash>/state.db`. Replace shared-knowledge-space principle with two-root-knowledge principle.
- **v3.0 (2026-04-17)**: Redesign §9 from per-agent workspace to shared knowledge space. [Superseded by v4.0]
- **v2.1 (2026-04-17)**: Redesign §9.2 for flat workspace layout (control hierarchy ≠ storage hierarchy). Add §9.3 Git-based change tracking (per-unit independent local git repo for change detection). Renumber §9.3→9.4, §9.4→9.5. Add two new design principles: control-storage-decoupling, git-change-tracking. [Superseded by v3.0]
- **v2.0 (2026-04-16)**: Add §9 Agent Workspace Model (workspace ownership, directory organization, knowledge artifacts, cross-workspace reading) and §10 Dual-Channel Knowledge Sharing (knowledge channel design, report-with-reference pattern, knowledge integration, discoverability, staleness). Add three new design principles: agent-workspace-ownership, knowledge-channel-complement, reference-over-copy. Update scope and relevant principles to include P27, P28. Renumber §9 (excluded scope) to §11, §10 (principles) to §12.
- **v1.2 (2026-04-15)**: Remove v1 skill system code entirely: `skills.ts`, `CapabilityBundle`, `CapabilityProvider`, `installSkill` tool, skill binding persistence, `adapters/skills/` directory, `skill-system.md` design doc. Add Writing Guidance subsection to prompt (conciseness, root AGENT.md context-budget awareness, content direction, update timestamps). Tool surface now uses `getBuiltInToolList()` directly; `LocalNodeToolExecutor` simplified to built-in tools only. SQLite schema bumped to v4.
- **v1.1 (2026-04-15)**: Add §8 Prompt Injection Design: workspace root = CLI cwd(), knowledge space boundary, static Knowledge View Guideline (includes absolute workspace root path), dynamic Workspace Knowledge (root AGENT.md read each turn). Runtime initialization writes default AGENT.md and skills/AGENT.md to workspace root on first startup. Remove `buildSkillPromptAppendix()` from prompt assembly. Add prompt-realization and knowledge-space-boundary principles.
- **v1.0 (2026-04-14)**: Initial version. Supersedes `skill-system.md`. Defines knowledge view as a cognitive view on the file system substrate, introduces AGENT.md as local knowledge entry page with soft structural conventions, cross-directory referencing, skill reabsorption, and explicit scope exclusion of governance mechanisms.
