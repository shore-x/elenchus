---
title: "Elenchus Framework Design - Skill System"
date: 2026-04-12
version: 1.0
---

# Skill System

> **Synchronization note**
> - This document expands the installable-skill summary in [../framework-design.md](../framework-design.md).
> - If skill package format, layer injection rules, tool registration, execution semantics, or persistence bindings change here, also review the overview summary in `framework-design.md` / Chapter 4 and Chapter 5.
> - If `framework-design.md` changes the high-level capability model or layer semantics, confirm whether this file must also be updated.

## Scope

This document specifies:

- what an installable skill is in Elenchus
- why skills are modeled as capability bundles rather than protocol entities
- the v1 skill package format
- layer-specific injection rules
- how skill tools participate in proposal-vote and blocking execution
- how runtime hot install refreshes capability snapshots at turn boundaries
- how skill bindings are persisted and checked on cold start

It complements the execution semantics in [protocol-and-runtime.md](./protocol-and-runtime.md), the layer model in [hierarchy-and-layers.md](./hierarchy-and-layers.md), and the tool-surface summary in [state-machine-and-tools.md](./state-machine-and-tools.md).

## Relevant Overview Sections

- `framework-design.md` / Chapter 4 summary
- `framework-design.md` / Chapter 5 summary
- `framework-design.md` / Principles index: P2, P8, P9, P10

---

## 1. Skill Position in the Architecture

A skill is an **installable capability bundle**. It is not:

- a new FSM state
- a new protocol family
- a new ledger message kind
- a child-unit subtype

Instead, a skill extends a unit through two existing extension surfaces:

- **prompt appendix**: additional task-domain guidance injected into the system prompt
- **blocking tools**: additional proposal-producing tools that enter `Executing` after approval

This keeps the core deliberation protocol unchanged.

### 1.1 Why skills are not protocol entities

Elenchus already has a stable action protocol:

- propose
- vote
- approve or reject
- execute or not execute

A skill should expand the set of available actions and local guidance, not introduce a second action model. Therefore skills belong to runtime capability assembly rather than to the protocol core.

### 1.2 Capability-bundle interpretation

At runtime, installed skills are compiled into a capability bundle, but the session no longer treats that bundle as a single immutable startup artifact. Instead, the session owns a shared **capability provider** that can refresh the installed-skill set and publish a new capability snapshot.

This means:

- all units in the same session share the same capability provider
- each individual turn reads one snapshot from that provider and uses it consistently for prompt construction plus tool exposure
- a newly installed skill does not retroactively change an already-started turn; it becomes visible from the next turn that reads the refreshed snapshot
- each unit only sees the subset applicable to its layer

The current hot-install implementation only supports additive change: new skills may appear at runtime, but running sessions do not yet support in-place skill modification, deletion, or upgrade.

## 2. Layer Injection Rules

The current v1 policy is intentionally simple:

- installed skills are injected into **L1** and **L2** by default
- installed skills are **not** injected into **L0**

### 2.1 Why not inject skills into L0

L0 remains the pure coordination layer. It should reason about:

- task framing
- decomposition
- upward coordination
- child management

rather than carrying every execution-oriented skill appendix and tool surface.

This keeps L0 small, preserves its coordination role, and avoids polluting top-level planning with implementation-local execution affordances.

### 2.2 Relation to layer isomorphism

This does **not** break prompt or protocol isomorphism.

The invariant remains:

- all layers share the same base protocol and prompt structure
- layer differences arise from capability injection

Skill appendices and skill tools are treated as part of the injected capability surface, so they follow the same architectural rule already used for built-in tool differences.

## 3. Skill Package Format (v1)

The v1 package format deliberately favors implementation simplicity over ecosystem-perfect compatibility.

A skill lives under:

- `skills/<skill-id>/`

with the following required files:

- `skill.json` — structured manifest
- `SKILL.md` — prompt appendix body

Optional subdirectories such as `scripts/` may contain local executables used by the skill tools.

### 3.1 Why not YAML frontmatter in v1

Mainstream agent ecosystems often use `SKILL.md` plus YAML frontmatter. Elenchus v1 instead uses `skill.json` plus `SKILL.md` because:

- the manifest must be parsed deterministically without adding extra parser dependencies
- tool schemas and runner metadata are easier to validate in JSON
- the prompt body still remains natural-language Markdown

This choice is an implementation simplification, not a rejection of the broader skill ecosystem direction.

### 3.2 `skill.json` shape

A skill manifest should provide at least:

- `id`
- `name`
- `description`
- `version`
- `appliesToLayers` (optional; default `['L1', 'L2']`)
- `tools`

Each tool entry should provide at least:

- `name` — local skill tool name, before namespacing
- `description`
- `parameters` — JSON-schema-style object describing action arguments only
- `runner`

### 3.3 Runner model

The v1 runner model is intentionally narrow:

- runner type: **local blocking command** only

A runner specifies:

- `command`
- `args`
- optional `cwd`
- optional `timeoutMs`

All paths are resolved relative to the skill directory when written as relative paths.

Argument interpolation may reference:

- `{{skillDir}}`
- `{{arg.<name>}}`

The runner model is deliberately **structured**, not a raw shell shortcut. The framework should execute skill tools through command-and-argv invocation rather than by concatenating an arbitrary shell string.

## 4. Tool Registration Model

Skill tools must be compiled into the same runtime tool registry as built-in tools.

### 4.1 Namespacing

To avoid collisions, each skill tool is exported under a namespaced runtime name:

- `skill.<skillId>.<toolName>`

The manifest's local `name` is therefore not the final tool name seen by the LLM.

### 4.2 Proposal-producing semantics

Every skill tool is treated as:

- a **proposal-producing** tool
- a **blocking** tool
- an **environment-side** action for FSM purposes

This means the framework automatically adds `proposedStep` to the callable schema presented to the model, even though the skill manifest only defines the domain-specific action arguments.

### 4.3 Review standard

A skill tool must not receive relaxed scrutiny merely because it appears specialized.

The reviewing agent should still assess:

- whether the tool is appropriate now
- whether its parameters are complete and bounded
- whether the proposed step actually advances the task

## 5. Proposal-Vote and Execution Semantics

Skill tools fully participate in the existing dual-agent protocol.

### 5.1 Turn-time availability

If a unit is at L1 or L2, and the skill applies to that layer, then the skill tool appears in the per-turn tool list together with built-in tools.

If the unit is at L0, the skill tool does not appear.

### 5.2 Proposal semantics

When one agent calls a skill tool:

- the call is parsed as a normal proposal
- it is written to the ledger as `proposal_message`
- the partner must vote through the normal `vote` tool

There is no special bypass path for skills.

### 5.3 Approval and commit boundary

If a skill proposal is approved:

- the tool's `proposedStep` enters `commitLog`
- the unit enters `Executing`
- the skill runner executes synchronously as a blocking action
- the result is written as `tool_result_message`

As with built-in blocking tools, approval is the commitment boundary even if the execution later fails.

### 5.4 FSM effect

Skill tools do not add new transitions.

They reuse the existing blocking-action transitions:

- `TurnA -> Executing`
- `TurnB -> Executing`
- `Executing -> opposite turn`

This follows principle P8: blockingness is determined by the kind of external action being performed, not by whether the tool is built-in or skill-provided.

### 5.5 Runtime hot-install tool

The framework also provides a built-in blocking environment tool:

- `installSkill`

This tool is not skill-provided. It is part of the runtime's own capability-management surface.

`installSkill`:

- is available only at L1 and L2
- is proposal-producing and blocking like other environment tools
- currently accepts only a **local directory** source
- requires the source directory to already contain a valid `skill.json` and `SKILL.md`
- installs atomically into the runtime-managed `skills/` directory
- refreshes the shared capability provider on success
- makes the newly installed skill visible from the next turn rather than the current one

## 6. Prompt Injection Model

A skill contributes a prompt appendix from `SKILL.md`.

The system prompt remains structurally:

- base protocol guideline
- layer orientation
- agent cognitive style
- installed-skill appendix for the current layer, if any

### 6.1 Appendix content

The appendix should explain:

- what the skill is for
- when to use it
- what its tools mean
- important limits or failure modes

The appendix should not try to redefine core protocol behavior.

### 6.2 Injection rule

All applicable installed skills are injected for L1 and L2 in v1.

The layer policy remains static, but the concrete installed-skill set is refreshed at turn boundaries through the shared capability provider. The runtime still does not perform relevance-based lazy activation.

### 6.3 Turn-boundary refresh rule

Hot install uses **turn-boundary capability refresh**:

- each `AgentTurn.execute()` reads the current capability snapshot before building the system prompt and tool list
- that snapshot remains fixed for the duration of the turn
- if another unit hot-installs a new skill while the current turn is already in flight, the current turn keeps its original snapshot
- later turns naturally see the refreshed prompt appendix and tool set

## 7. Persistence and Cold-Start Recovery

Skills are installed from the file system, but the session must still persist which skill set it was running with.

### 7.1 What is persisted

The session should persist a binding snapshot for each installed skill, including at least:

- `skillId`
- `version`
- `contentHash`
- `sourcePath`
- `appliesToLayers`

This is session configuration metadata, not replacement storage for the skill package itself.

### 7.2 Why persist bindings

Without persisted bindings, a recovered session could silently resume under a different capability set than the one that produced its earlier ledger and commit history.

### 7.3 Recovery check

On cold start, the runtime should:

- reload currently installed skills from disk
- compare them with the persisted bindings
- emit a recovery warning if they differ

The v1 policy is **warn and continue** rather than strict refusal.

### 7.4 Runtime install persistence effect

When `installSkill` succeeds at runtime:

- the shared capability provider refreshes immediately
- the next durable session save persists the refreshed binding set
- future cold starts compare against that newer binding snapshot rather than the pre-install set

## 8. Non-Goals for v1

The current skill system deliberately does **not** attempt to support:

- custom non-blocking skill tools
- skill-defined protocol mutations
- skill-specific FSM transitions
- runtime uninstall from within agent dialogue
- runtime in-place skill modification or upgrade
- remote registries or marketplace semantics
- installation directly from arbitrary documentation URLs
- relevance-based lazy skill activation

These may be explored later, but they are intentionally excluded from the minimal design.

## 9. Related Detailed Documents

- Runtime action semantics: [protocol-and-runtime.md](./protocol-and-runtime.md)
- Layering and delegation semantics: [hierarchy-and-layers.md](./hierarchy-and-layers.md)
- FSM and tool availability: [state-machine-and-tools.md](./state-machine-and-tools.md)

---

## Change Log

- **v1.1 (2026-04-13)**: Extended the skill system from startup-only loading to turn-boundary hot install. Added a shared capability-provider model, the built-in blocking `installSkill` tool for local skill-package directories, next-turn visibility semantics, and persisted binding refresh after successful runtime installation.
- **v1.0 (2026-04-12)**: Introduced the initial installable-skill design. Skills are modeled as runtime capability bundles that contribute prompt appendix plus blocking tools, defaulting to L1/L2 injection only. Added namespaced skill tools, structured local-command runners, proposal-vote compatibility, and persisted skill binding checks for cold-start recovery.
