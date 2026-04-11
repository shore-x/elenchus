// Elenchus - System Prompts
// System Prompt = buildSystemPrompt(agentId, level)
//              = SHARED_GUIDELINE (with Context Grounding) + AGENT_COGNITIVE_STYLE[agentId]
// All layers share the same prompt structure (§4.3.1 Prompt Isomorphism).
// Behavioral differences emerge from the tool list injected per-turn, not from prompt rules.
// Agent A and Agent B are symmetric peers with different cognitive lenses, not different roles.
// Guideline: architecture, collaboration protocol, context grounding principle.
// Cognitive Style: epistemic strategy (evidence evaluation + reasoning organization).

export * from "./core/prompts.js";
