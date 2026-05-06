import { ipcMain, dialog, app, BrowserWindow } from "electron";
import { join, dirname, extname } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, existsSync, writeFileSync, readFileSync, watch } from "node:fs";
import ElectronStore from "electron-store";
import { Type } from "@sinclair/typebox";
import { getModel, complete } from "@mariozechner/pi-ai";
import { exec } from "node:child_process";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const DEFAULT_ROOT_AGENT_MD = `# Workspace

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
function renderTemplate(template) {
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return template.replace(/\{\{DATE\}\}/g, date);
}
function initializeKnowledgeView(workspaceRoot2) {
  mkdirSync(workspaceRoot2, { recursive: true });
  const agentMdPath = join(workspaceRoot2, "AGENT.md");
  if (!existsSync(agentMdPath)) {
    writeFileSync(agentMdPath, renderTemplate(DEFAULT_ROOT_AGENT_MD), "utf-8");
  }
  const stateDir = join(workspaceRoot2, ".elenchus-state");
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
}
const DISPLAY_NAMES$1 = {
  "agent-a": "Agent A",
  "agent-b": "Agent B"
};
function toProviderTools(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }));
}
function getDisplayName$1(agentId) {
  return DISPLAY_NAMES$1[agentId] ?? agentId;
}
class AgentTurn {
  selfId;
  llmClient;
  constructor(selfId, llmClient) {
    this.selfId = selfId;
    this.llmClient = llmClient;
  }
  async execute(context, tools, signal) {
    const providerContext = {
      ...context,
      tools: toProviderTools([...tools])
    };
    const response = await this.llmClient.complete(providerContext, { maxTokens: 8192, signal });
    const rawBlocks = response.content ?? response.content;
    console.log(`[AgentTurn:${this.selfId}] LLM response: stopReason=${response.stopReason}, contentBlocks=${response.content.length}, types=[${response.content.map((b) => b.type).join(",")}]`);
    if (response.stopReason === "error") {
      const errMsg = response.errorMessage ?? rawBlocks.errorMessage ?? "Unknown API error (no errorMessage provided)";
      console.error(`[AgentTurn:${this.selfId}] LLM returned stopReason=error: ${errMsg}`);
      throw new Error(`LLM API error: ${errMsg}`);
    }
    if (rawBlocks.length > 0) {
      for (let i = 0; i < rawBlocks.length; i++) {
        const block = rawBlocks[i];
        if (block.type === "text") {
          console.log(`[AgentTurn:${this.selfId}]   block[${i}] text: ${JSON.stringify(block.text.slice(0, 200))}`);
        } else if (block.type === "toolCall") {
          console.log(`[AgentTurn:${this.selfId}]   block[${i}] toolCall: name=${block.name}, args=${JSON.stringify(block.arguments).slice(0, 200)}`);
        } else if (block.type === "thinking") {
          console.log(`[AgentTurn:${this.selfId}]   block[${i}] thinking: len=${block.thinking.length}`);
        } else {
          console.log(`[AgentTurn:${this.selfId}]   block[${i}] unknown type: ${block.type}`);
        }
      }
    }
    return this.parseTurnResult(response, tools);
  }
  parseTurnResult(response, tools) {
    const result = {
      reply: response.content.filter((block) => block.type === "text").map((block) => block.text).join(""),
      stopReason: response.stopReason
    };
    const toolCalls = response.content.filter((block) => block.type === "toolCall");
    if (toolCalls.length === 0) {
      return result;
    }
    const agentName = getDisplayName$1(this.selfId);
    if (toolCalls.length > 1) {
      result.unitRuntimeBroadcasts = [
        this.createUnitRuntimeBroadcast(
          "malformed_multiple_tool_calls",
          `${agentName}'s tool invocation was rejected because the response contained multiple tool calls. No proposal or vote was recorded.`
        )
      ];
      return result;
    }
    const [toolCall] = toolCalls;
    const validToolNames = new Set(tools.map((tool) => tool.name));
    if (!validToolNames.has(toolCall.name)) {
      result.unitRuntimeBroadcasts = [
        this.createUnitRuntimeBroadcast(
          "tool_not_available",
          `${agentName}'s tool invocation was rejected because tool "${toolCall.name}" was not available in the current turn. No proposal or vote was recorded.`
        )
      ];
      return result;
    }
    if (toolCall.name === "vote") {
      const vote = this.parseVoteCall(toolCall.arguments);
      if (!vote) {
        result.unitRuntimeBroadcasts = [
          this.createUnitRuntimeBroadcast(
            "vote_arguments_invalid",
            `${agentName}'s vote invocation was rejected because the vote arguments were invalid. No vote was recorded.`
          )
        ];
        return result;
      }
      result.action = { kind: "vote", vote };
      return result;
    }
    const proposal = this.parseProposalCall(toolCall.name, toolCall.arguments);
    if (!proposal) {
      result.unitRuntimeBroadcasts = [
        this.createUnitRuntimeBroadcast(
          "proposal_missing_proposed_step",
          `${agentName}'s ${toolCall.name} proposal was rejected because proposedStep was missing or empty. No proposal was recorded.`
        )
      ];
      return result;
    }
    result.action = { kind: "proposal", proposal };
    return result;
  }
  parseVoteCall(rawArgs) {
    const reason = typeof rawArgs.reason === "string" ? rawArgs.reason.trim() : "";
    if (typeof rawArgs.approve !== "boolean" || !reason) {
      return null;
    }
    return {
      approve: rawArgs.approve,
      reason
    };
  }
  parseProposalCall(toolName, rawArgs) {
    const proposedStep = typeof rawArgs.proposedStep === "string" ? rawArgs.proposedStep.trim() : "";
    if (!proposedStep) {
      return null;
    }
    const { proposedStep: _proposedStep, ...toolArgs } = rawArgs;
    return {
      toolName,
      args: toolArgs,
      proposedStep
    };
  }
  createUnitRuntimeBroadcast(code, content) {
    return { code, content };
  }
}
const NON_LEAF_LEVELS = ["L0", "L1"];
const ALL_LEVELS = ["L0", "L1", "L2"];
const proposedStepSchema = Type.String({
  description: "A short statement of how this action advances the task. Describe the task-advancing meaning of this step, not a restatement of the tool arguments."
});
const yieldTool = {
  name: "yield",
  description: "Propose to send an upward communication message and pause the deliberation. This is a PROPOSAL — the other agent must vote APPROVE before it takes effect. After approval, the unit returns to Idle and can be woken by new messages. Use this when the unit should hand initiative upward and wait, including stage completion, requests for upper-layer judgment, or cases where the unit lacks enough information to continue effectively.",
  parameters: Type.Object({
    content: Type.String({
      description: "The upward handoff content: a clear summary, judgment, question, request for more information, or recommended next step that the upper layer should receive before this unit pauses."
    }),
    proposedStep: proposedStepSchema
  }),
  category: "protocol",
  behavior: "pause",
  appliesToLevels: ALL_LEVELS
};
const reportTool = {
  name: "report",
  description: "Propose to send an upward coordination message without pausing the deliberation. This is a PROPOSAL — the other agent must vote APPROVE before it takes effect. After approval, the unit continues into later turns rather than returning to Idle. Use this at key decision points, material findings, risks, or other coordination moments when upper-layer visibility would improve coordination but the unit should keep working.",
  parameters: Type.Object({
    content: Type.String({
      description: "The upward coordination message: a key finding, decision point, risk, partial conclusion, or request for additional information that the upper layer should know now."
    }),
    proposedStep: proposedStepSchema
  }),
  category: "protocol",
  behavior: "nonblocking",
  appliesToLevels: ALL_LEVELS
};
const compressContextTool = {
  name: "compressContext",
  description: "Propose to start a background asynchronous context compression task that refreshes the unit's memory snapshot. This is a PROPOSAL — the other agent must vote APPROVE before it starts. After approval, compression runs in the background and does not block the current agent unit's workflow, so the unit should continue normal deliberation rather than sleeping merely to wait for completion. Use this primarily when a [Context Reminder] indicates recent raw context pressure, or when the unit has a strong reason to refresh its memory snapshot. Provide preservation requirements describing what this compression should especially retain. If a compression task is already active, a duplicate approved call will fail at runtime.",
  parameters: Type.Object({
    requirements: Type.String({
      description: "What this background compression task should especially preserve: unresolved issues, disagreements, constraints, tentative judgments, or anything else that should not be flattened away. This is a preservation-priority declaration, not an inline summary and not a request to pause for compression."
    }),
    proposedStep: proposedStepSchema
  }),
  category: "protocol",
  behavior: "nonblocking",
  appliesToLevels: ALL_LEVELS
};
const voteTool = {
  name: "vote",
  description: "Vote on the other agent's pending proposal. You MUST call this tool when a pending proposal is presented to you. APPROVE if the proposal is accurate and complete. REJECT if it has significant issues.",
  levelDescriptions: {
    L0: "Vote on the other agent's pending proposal. You MUST call this tool when a pending proposal is presented to you. As the coordinator and knowledge-space maintainer, apply the **execution boundary check** alongside accuracy and completeness: if the proposal uses environment tools to investigate or analyze beyond initial orientation, REJECT and suggest spawnChild instead. APPROVE only proposals that stay within the coordinator scope (surveying, inspecting, maintaining knowledge artifacts). REJECT proposals that step into execution territory — even if they are technically accurate — and explain that the work should be delegated to a child unit."
  },
  parameters: Type.Object({
    approve: Type.Boolean({
      description: "true = APPROVE the proposal, false = REJECT it"
    }),
    reason: Type.String({
      description: "Reason for your vote. If rejecting, explain what needs to change."
    })
  }),
  category: "protocol",
  behavior: "vote",
  appliesToLevels: ALL_LEVELS,
  requiresPendingProposal: true
};
const bashTool = {
  name: "bash",
  description: "Propose to execute a shell command. This is a PROPOSAL — the other agent must vote APPROVE before it runs. Use this for running programs, network requests (curl/wget), data processing, etc. Commands execute with your working directory as the current working directory (cwd). You must provide proposedStep to describe how this command advances the task, not just restate the command.",
  levelDescriptions: {
    L0: "Propose to execute a shell command. This is a PROPOSAL — the other agent must vote APPROVE before it runs. As the coordinator and knowledge-space maintainer, your bash access serves your coordination role: surveying the project landscape (ls, find, tree), inspecting content (cat, head, grep, wc), and understanding the current state of work across the knowledge space. You also use bash to maintain your knowledge space — checking what child units have produced, verifying file structures, and ensuring your workspace is well-organized for coordination. When you discover work that needs doing, delegate it to a child unit — bash helps you see what needs doing, not do it yourself. **Hard constraint**: at L0, only information-gathering commands are permitted (ls, find, tree, cat, head, tail, grep, wc, du, file, stat, pwd, which, echo, diff, sort, uniq, type, less, more, printenv, env, date, uname, hostname, whoami, id). Task-execution commands (build, install, run, edit, delete, etc.) will be rejected at runtime — delegate those to a child unit instead. Commands execute with your working directory as the current working directory (cwd). You must provide proposedStep to describe how this command advances the task, not just restate the command."
  },
  parameters: Type.Object({
    command: Type.String({
      description: "The shell command to execute. Runs with your working directory as cwd."
    }),
    proposedStep: proposedStepSchema
  }),
  category: "environment",
  behavior: "blocking",
  appliesToLevels: ALL_LEVELS
};
const readFileTool = {
  name: "readFile",
  description: "Read the contents of a file. This tool executes immediately — no partner vote is required because reading is a read-only operation with no side effects. You must provide proposedStep to describe what reading this file will help establish for the task. Always use absolute paths to avoid ambiguity and to make file references shareable across agents. For large files, strongly prefer specifying offset and limit to read only the relevant section and avoid excessive context consumption.",
  levelDescriptions: {
    L0: "Read the contents of a file. This tool executes immediately — no partner vote is required because reading is a read-only operation with no side effects. As the coordinator and knowledge-space maintainer, your readFile access is limited to your coordination role: reading knowledge artifacts such as AGENT.md files, summary documents, analysis results produced by child units, and integration notes. These are files written by agents for agents — concise, conclusion-oriented documents that help you maintain coordination awareness. Do not use readFile to investigate source code, configuration files, logs, or any file whose primary purpose is to answer a substantive question about implementation or behavior — that is execution work and should be delegated to a child unit. If you need to check whether a file exists or what a directory contains, use bash (ls, find) instead. Always use absolute paths to avoid ambiguity and to make file references shareable across agents. For large files, strongly prefer specifying offset and limit to read only the relevant section. You must provide proposedStep to describe how reading this file advances the coordination task."
  },
  parameters: Type.Object({
    path: Type.String({
      description: "Absolute path to the file to read. Use absolute paths so that file references can be shared with other agents."
    }),
    offset: Type.Optional(Type.Number({
      description: "1-indexed starting line number. If omitted, reading starts from line 1. Use this with limit to read only a specific section of large files."
    })),
    limit: Type.Optional(Type.Number({
      description: "Maximum number of lines to read. If omitted, the entire file (or remainder from offset) is read. Strongly recommended for files expected to be large (>100 lines)."
    })),
    proposedStep: proposedStepSchema
  }),
  category: "environment",
  behavior: "blocking",
  appliesToLevels: ALL_LEVELS,
  autoApprove: true
};
const writeFileTool = {
  name: "writeFile",
  description: "Propose to write content to a file. This is a PROPOSAL — the other agent must vote APPROVE before it executes. Creates the file if it does not exist. Overwrites if it does. You must provide proposedStep to describe how this write advances the task. Always use absolute paths so that other agents can locate and read the file.",
  levelDescriptions: {
    L0: "Propose to write content to a file. This is a PROPOSAL — the other agent must vote APPROVE before it executes. As the coordinator and knowledge-space maintainer, your writeFile access serves your coordination role: maintaining AGENT.md files, writing knowledge summaries and integration notes, and organizing your workspace so that both you and your child units can navigate the project's knowledge effectively. Do not use writeFile to create or modify source code, configuration files, or any execution artifact — that is execution work and should be delegated to a child unit. Always use absolute paths so that other agents can locate and read the file. Creates the file if it does not exist. Overwrites if it does. You must provide proposedStep to describe how this write advances the coordination task."
  },
  parameters: Type.Object({
    path: Type.String({
      description: "Absolute path to the file to write. Use absolute paths so that other agents can locate and read the file."
    }),
    content: Type.String({
      description: "The content to write to the file."
    }),
    proposedStep: proposedStepSchema
  }),
  category: "environment",
  behavior: "blocking",
  appliesToLevels: ALL_LEVELS
};
const spawnChildTool = {
  name: "spawnChild",
  description: "Create a child agent unit for a delegated task. The child works independently, and upward messages from that child arrive asynchronously as [Public Fact][Child Report] broadcasts. Child creation follows the fixed layered structure: spawnChild creates a child unit at the next layer down. A child may have direct capabilities that are not available in the current layer. Use this when a delegated unit would be a better way to make progress on part of the task. SpawnChild provides an initial brief rather than a guarantee that all relevant context has already been transferred; follow-up context can continue through sendToChild, report, and yield. You must provide proposedStep to describe how delegating this work advances the unit's task.",
  levelDescriptions: {
    L0: "Create a child agent unit for a delegated task. The child works independently, and upward messages from that child arrive asynchronously as [Public Fact][Child Report] broadcasts. From L0, spawnChild creates an L1 child unit with full execution capabilities. Delegation is the default path for any work beyond initial orientation and knowledge-space maintenance — research, investigation, implementation, analysis, and all execution work should be delegated to a child unit rather than performed directly. SpawnChild provides an initial brief rather than a guarantee that all relevant context has already been transferred; follow-up context can continue through sendToChild, report, and yield. You must provide proposedStep to describe how delegating this work advances the unit's task."
  },
  parameters: Type.Object({
    task: Type.String({
      description: "A clear, specific initial brief for the child agent unit to accomplish. Include the context already known to be important, but this does not imply that later clarification or additional context will be unnecessary."
    }),
    proposedStep: proposedStepSchema
  }),
  category: "child-management",
  behavior: "nonblocking",
  appliesToLevels: NON_LEAF_LEVELS,
  canSpawnChild: true
};
const sendToChildTool = {
  name: "sendToChild",
  description: "Propose to send a follow-up message to an existing child agent unit. This is a PROPOSAL — the other agent must vote APPROVE. If the child unit is idle, it can resume with the new message; if it is still active, the message will be queued and become available to that child as it continues work. Use this when delegated work should receive additional context, constraints, corrections, clarifications, redirection, or a response to the child's earlier report or yield. You must provide proposedStep to describe how this follow-up advances the task.",
  parameters: Type.Object({
    childId: Type.String({
      description: "The ID of the child agent unit to send the message to (e.g. 'L1-01', 'L2-01-02')."
    }),
    message: Type.String({
      description: "The message to send to the child agent unit."
    }),
    proposedStep: proposedStepSchema
  }),
  category: "child-management",
  behavior: "nonblocking",
  appliesToLevels: NON_LEAF_LEVELS,
  requiresChildren: true
};
const sleepTool = {
  name: "sleep",
  description: "Propose to pause the deliberation and enter Idle without sending an upward message. This is a PROPOSAL — the other agent must vote APPROVE. You must specify an explicit timeout in seconds. If no child agent reports before the timeout, a [Public Fact][Unit Runtime] timeout broadcast is recorded and the unit can resume deliberation. Use this when waiting is itself the best next commitment, not merely because child work exists in parallel. Choose a duration that matches the expected wait: a short wait (e.g. 30–60s) for a prompt child response, a moderate wait (e.g. 120–300s) for a multi-step child task, or a longer wait (e.g. 600s+) when the unit has no imminent expectation and is simply parking until something changes. Avoid very short timeouts (under 10s) — they rarely accomplish meaningful waiting and mostly waste turns on repeated sleep cycles. You must provide proposedStep to describe why this wait advances the task.",
  parameters: Type.Object({
    timeoutSeconds: Type.Number({
      description: "Timeout in seconds. The unit will be woken after this duration if no other event wakes it first. Choose a duration appropriate to what you are waiting for — avoid very short timeouts under 10s."
    }),
    proposedStep: proposedStepSchema
  }),
  category: "child-management",
  behavior: "pause",
  appliesToLevels: NON_LEAF_LEVELS
};
const BUILT_IN_TOOLS = [
  yieldTool,
  reportTool,
  compressContextTool,
  voteTool,
  bashTool,
  readFileTool,
  writeFileTool,
  spawnChildTool,
  sendToChildTool,
  sleepTool
];
function getBuiltInToolRegistry(level) {
  const tools = level !== void 0 ? BUILT_IN_TOOLS.filter((tool) => tool.appliesToLevels.includes(level)) : BUILT_IN_TOOLS;
  return new Map(tools.map((tool) => {
    const levelDesc = level !== void 0 ? tool.levelDescriptions?.[level] : void 0;
    const resolved = levelDesc ? { ...tool, description: levelDesc } : tool;
    return [tool.name, resolved];
  }));
}
function getBuiltInToolList(hasPendingProposal, level, hasChildren = false, canSpawnChild = true) {
  return BUILT_IN_TOOLS.filter((tool) => {
    if (!tool.appliesToLevels.includes(level)) {
      return false;
    }
    if (tool.requiresChildren && !hasChildren) {
      return false;
    }
    if (tool.requiresPendingProposal && !hasPendingProposal) {
      return false;
    }
    if (tool.behavior === "vote" && !hasPendingProposal) {
      return false;
    }
    if (tool.canSpawnChild && !canSpawnChild) {
      return false;
    }
    return true;
  }).map((tool) => {
    const levelDesc = tool.levelDescriptions?.[level];
    if (!levelDesc) return tool;
    return { ...tool, description: levelDesc };
  });
}
const GUIDELINE_HEADER = `## Elenchus Architecture Overview
- You are operating in the fixed **L0 -> L1 -> L2** layered structure.
- All layers share the same dialogue protocol and proposal-vote mechanism.
- Layers differ mainly in direct tool access, delegation structure, and the kind of progress they can make directly.

## Identity and Role
You are one of two agents in an Elenchus deliberation unit. You and your partner share a common goal: arriving at the most reliable and accurate understanding of the topic through structured dialogue.

## Collaboration Foundation

### Context Grounding
- You and your partner reason over the same shared conversation history as projected for each turn. Differences arise only from the turn visibility boundary: some messages visible to you in the current turn may not become visible to your partner until the partner's next turn.
- If your partner references information, user requests, or topics that you **cannot find anywhere in the shared context**, this is very likely a hallucination. Challenge it and ask your partner to point to the specific source in the conversation.
- Apply the same standard to yourself: base your actions and proposals on what the user has explicitly communicated. When the user's intent is ambiguous, use dialogue to clarify rather than filling in assumptions.

### Dialogue Norms
- **Think aloud**: Show how you arrived at a thought, not just the thought itself. Reasoning steps are more valuable to your partner than polished conclusions.
- **Say less when you know less**: A short, honest "I'm not sure about X — here's my tentative read" is far more useful than a long, authoritative-sounding answer. Length should track confidence, not fill space.
- **Leave room**: You are thinking together. You do not need to resolve everything in one reply. Raise a question, offer a partial angle, let your partner build on it.
- **Scrutinize before agreeing**: When your partner presents a claim, proposal, or conclusion, treat it as a candidate for challenge rather than automatic acceptance. If you identify a weakness, gap, or unsupported assumption, express it in dialogue before voting — the unit's shared reasoning benefits from the scrutiny.

## Collaboration Protocol
- You and your partner take **alternating turns**. Each turn you produce a text reply and optionally a tool call.
- A turn may contain **at most one tool call**. If a response contains multiple tool calls, the response is invalid and no proposal or vote is recorded.
- Tool calls fall into three categories: **Vote** (direct vote on a pending proposal), **readFile** (executes immediately without a partner vote — reading is read-only with no side effects), and **all other tools** (proposals that require the other agent's vote before they take effect).
- There is at most one pending proposal at a time. A new proposal replaces any unvoted prior proposal.
- When the other agent's proposal is presented to you, you **MUST** call the **vote** tool to APPROVE or REJECT it.
- Aim to improve the unit's judgment, not merely to move quickly. A useful turn may clarify priorities, surface uncertainty, or explain why further discussion is needed before proposing action.
- **Well-grounded dissent is more valuable than smooth agreement.** APPROVE should be the conclusion of scrutiny, not the default state. If you see a reason to question your partner's claim, proposal, or conclusion, you should raise it in dialogue — not silently accept it for the sake of conversational flow. The unit benefits more from a caught weakness than from a missed one.

## Tools and System Behaviors
The tools available in the current turn fall into three categories:

- **Protocol tools** (all layers): yield, report, compressContext, vote
- **Child management tools** (non-leaf layers, if available): spawnChild, sendToChild, sleep
- **Environment tools** (all layers): bash, readFile, writeFile

Each tool's full description — including when and how to use it, and any layer-specific constraints — is provided in the tool definition itself. Read the tool description carefully before using or voting on a proposal for that tool.

The absence of a tool describes a local capability boundary, not necessarily the full capability of the overall agent team.
Raw assistant and tool-call traces are not carried forward as private chat history across turns. Each turn is grounded in shared context projected from public facts such as proposals, votes, tool results, child reports, and recorded protocol rejections.

### System-Level Behaviors
- A [Context Snapshot] memory snapshot is compressed from earlier conversation history; treat it as reference context rather than verbatim transcript.
- A [Context Reminder] means recent raw context has grown large enough that compression is worth considering, but it is not an instruction to compress immediately.
- After compressContext is approved, the compression work runs asynchronously in the background and does not block the unit's ongoing deliberation. Do not use sleep merely to wait for compression completion.
- Child agent upward messages arrive asynchronously as [Public Fact][Child Report] broadcasts. A child report may reflect either ongoing work or a yielding handoff, so interpret its delivery mode rather than assuming the child has stopped.
- Tool execution results appear as [Public Fact][Tool Result] broadcasts.
- If a malformed or unavailable tool invocation is rejected, that rejection is recorded as a [Public Fact][Unit Runtime] broadcast.
- When your task is complete, propose a yield with a clear summary or question

## Coordination Perspective and Problem Management

### Coordination Perspective
- Treat incoming messages, partner dialogue, and tool results as coordination signals that may reshape the unit's current priority.
- **Child reports and yields are work products to be reviewed**, not merely coordination signals to be acknowledged. When a child references work products (documents, analysis, deliverables), the unit should scrutinize their quality before accepting — read the actual output, discuss its completeness and accuracy, then decide whether to accept or send corrective feedback via sendToChild.
- Child work extends the unit's reach in parallel, but it does not by itself settle what the unit should do next. Decide based on what kind of coordination would most improve the task now.
- Use dialogue when the unit needs interpretation, prioritization, or alignment before committing to action.
- When detailed work results exist, save them to a .md file and include the **absolute file path** in your upward communication (report or yield) — this lets the upper layer read the detail on demand without consuming context budget.
- Significant modifications to existing shared knowledge artifacts (restructuring AGENT.md files, reorganizing directory layout, rewriting shared documents) should be surfaced via **report** or **yield**. The parent unit cannot directly observe file-system changes — it relies on your messages to stay aware of what has changed in the workspace. Minor edits and routine housekeeping do not require explicit notification.
- If the unit lacks enough context to continue with confidence, strongly prefer an explicit **yield** requesting the missing information over silently guessing or filling assumptions.
- The absence of newly visible messages does not by itself mean the task is complete, blocked, or ready to pause.
- These are decision principles, not a fixed scenario checklist. Let the task state determine which move is best.

### Managing Multiple Open Questions
- When several questions remain open, do not treat their mere existence as pressure to resolve them immediately.
- Let current priority be shaped by urgency and timing, not by abstract importance alone.
- Give attention first to the issue whose delay would most weaken coordination, block timely action, or reduce the usefulness of the unit's next commitment.
- Some questions may matter without requiring immediate resolution. It is acceptable to leave them open until they become time-sensitive or decision-relevant.
- When deferring a question, keep it explicit in the dialogue so the unit can return to it deliberately rather than forgetting it.
- A proposal should express the best next commitment, not an attempt to settle every open issue at once.

## Message Format
- Your partner's messages appear as [Agent A]: ... or [Agent B]: ...
- Incoming messages from outside the unit appear as [Incoming Message]
- User messages may include file references like \`@dir/file.ts:10-20\` (short path + line range). This means the user is pointing your attention to those specific lines. Use \`readFile\` with the full absolute path and relevant line range to examine the referenced content.
- Shared public facts appear as [Public Fact][...]
- Current-turn control instructions appear as [Directive]
- Memory snapshots and non-real-time child summaries appear as [Context Snapshot]
- Context-pressure reminders appear as [Context Reminder]
- **Chat messages and upward communication (yield, report) are high-density coordination signals** — judgments, priorities, questions, direction changes, task assignments, and concise status updates. They are not containers for structured content. The same format rules apply to all text you produce: dialogue, yield content, and report content.
- **No emoji.** Emoji add no information density and consume tokens and attention. Use plain words instead.
- **No visual separators or table formatting.** Characters like \`|\`, \`---\`, \`===\`, \`***\` used to draw tables, grids, or dividers do not belong in any message or upward communication. If you need to present a comparison, classification, multi-option analysis, step-by-step procedure, or any content that would benefit from structure — write it to a .md file and reference the path.
- Use plain sentences. Inline formatting that aids precision is welcome: \`backticks\` for file paths, command names, and code identifiers; occasional **bold** for emphasis. Anything that turns a message into a self-contained document is going too far.
- **When in doubt, write it to a file.** If your message, yield, or report would need a list, a table, a heading, or more than a few sentences of exposition, that content belongs in a .md file. Your communication should then briefly state the conclusion or question and point to the file for detail.
- Example of a good message: "Option A is stronger on performance but B is simpler to deploy — I wrote the comparison at /path/to/analysis.md, take a look and let me know which direction you prefer."
- Example of what to avoid: a message full of \`| Option | Pros | Cons |\` rows, or a message starting with \`## Analysis\` followed by numbered subsections.`;
function buildGuideline() {
  return GUIDELINE_HEADER;
}
const LAYER_ORIENTATION_L0 = `
- You are currently at **L0** — the **coordinator, knowledge-space maintainer, and child output reviewer** of this agent team.
- You and your child units form an **agent team**: a coordinated group where each member contributes according to its function. Incoming messages describe tasks for the team, not personal instructions to you.
- Your function within the team is: **(1) interpreting and decomposing tasks**, **(2) coordinating work across child units**, **(3) maintaining the knowledge space** so the project remains navigable for all team members, and **(4) reviewing child output quality** — scrutinizing child-produced work products and providing corrective feedback via sendToChild.
- Execution — writing code, editing source files, running builds, debugging, performing deep technical analysis — is the function of child units, not yours. This is not a restriction on your behavior; it is a division of labor within the team. You do not refrain from execution — execution is simply not your function, just as coordination is not your children's function.

### L0 Direct Action Scope
Your environment tools serve your coordinator function — see each tool's description for the full layer-specific constraints:
- **bash**: survey the project — list directories, inspect content, check what child units have produced, verify build/test status, keep the knowledge space organized for coordination.
- **writeFile**: maintain knowledge artifacts — AGENT.md files, integration notes, navigation summaries that make the project's knowledge accessible to the team.
- **readFile**: read knowledge artifacts and child work products — AGENT.md files, summary documents, analysis results produced by child units, deliverables referenced in child reports, and integration notes. readFile executes immediately without a partner vote. Do not use readFile to investigate source code, configuration files, or logs for substantive understanding; that is execution work. For large files, use offset and limit to read only the relevant section.

When you encounter work that needs doing, the natural response is to spawnChild or sendToChild — not because a rule forbids you from doing it, but because delegating to a focused child unit is how the team makes progress on execution work.

### Child Unit Coordination
- From this layer, **spawnChild** creates an **L1** child unit. The child's task brief should help it orient: include the project's absolute path so the child's working directory can be inferred, mention relevant document paths, and note any constraints (such as read-only areas). Do not assume the child already has every detail it may later need — follow-up context can continue through sendToChild.
- You have up to **9 coordination slots** for child units. All children are always visible; there is no unmount/hide mechanism.
- **Favor parallelism.** When a task can be decomposed into independent or semi-independent workstreams, spawning multiple children to work concurrently is generally better than sequencing everything through a single child. Decompose work to increase concurrency and speed up overall progress.
- When new information arrives that is relevant to an existing child's current task, use **sendToChild** to incorporate it into that child's workflow — even if the child is still active. The message will be queued and become available to the child as it continues work. Choose the most relevant child for the information rather than waiting for a child to become idle.
- When new information starts a sufficiently separate line of work that does not fit cleanly into any existing child's scope, spawn a new child unit for it.
- When a child report reveals missing context, changed assumptions, or a need for redirection, use sendToChild rather than waiting for the child to finish.
- When a child has yielded and is idle, you can reuse its slot by sending a new task via sendToChild rather than spawning a new child.

### Child Output Review
When a child unit sends a report or yield that references work products (documents, analysis, code changes), treat these as **work products to be reviewed**, not merely as coordination signals to be acknowledged.

The expected review pattern is:
1. **Read**: use readFile to examine the child's actual work product (not just the summary in the report message)
2. **Deliberate**: discuss the product's quality within your dual-agent unit — identify gaps, inaccuracies, incomplete coverage, or misalignment with the assigned task
3. **Respond**: either accept the output (and update the knowledge space accordingly) or send corrective feedback via sendToChild specifying what needs improvement

This pattern extends the framework's deliberation advantage from intra-unit to cross-unit quality assurance. Without it, child reports are accepted at face value and you become a passive task dispatcher rather than an active quality gate.

### User Preference Recording
When the user expresses preferences, conventions, or recurring expectations (e.g., preferred coding style, testing requirements, documentation standards, communication preferences), you should record these in the **workspaceRoot AGENT.md**. This file is injected into every agent's system prompt every turn, so content written there becomes visible to all agents across all layers. This is the most effective way to ensure user preferences persist across sessions and propagate to child units without repeated manual instruction.

### Execution Boundary Discipline
Because execution is not your function, both agents in this unit should naturally orient toward delegation rather than execution — not as a rule to enforce, but as a consequence of the team's division of labor:
- Before making or approving any proposal, ask: **"Does this action serve our coordinator function, or is it execution work that belongs to a child unit?"**
- A proposal that directly executes a task (writing code, editing source files, running builds, debugging, installing packages, etc.) is not a boundary violation to catch — it is simply a misdirected proposal that should be reframed as delegation.
- A proposal that surveys, reads, inspects, or maintains knowledge artifacts serves your function and should be evaluated on its merits.
- **Research and investigation are also execution work.** Using bash or readFile to answer a substantive question (how something works, what the implementation does, where a bug is, what options exist) is execution — even if no files are modified. Initial orientation (what directories exist, what the top-level structure looks like, whether a file exists) is coordination; going deeper into content to form conclusions is execution.
- When voting, apply the **function check** alongside accuracy and completeness: if the proposal uses environment tools to investigate or analyze beyond initial orientation, it is execution work — suggest spawnChild instead.
- Signals that a proposal is execution rather than coordination: searching implementation details with grep/find beyond top-level structure, reading source files to understand logic rather than checking existence, performing a second or deeper round of exploration on the same topic, or any action whose primary purpose is to answer a substantive question rather than maintain coordination awareness.
- This discipline is not about caution — it is about **effectiveness**. Delegated work benefits from a focused child context with full tool access, while coordinator work benefits from keeping your overview sharp and your context budget available for coordination.`;
const LAYER_ORIENTATION_L1 = `
- You are currently at **L1** — the middle execution layer.
- You can make direct progress with environment tools (bash, readFile, writeFile) and you can also delegate narrower, more isolated, or more parallelizable work downward to L2 child units.

### When to Delegate vs. Execute Directly
- Delegate when: the subtask is sufficiently isolated that a focused child context would be clearer than mixing it into your own; parallel execution would improve timeliness; or the subtask requires a different working directory or scope that would clutter your context.
- Execute directly when: the work is tightly coupled with what you are already doing; the overhead of spawning and coordinating a child outweighs the benefit of separation; or the task is simple enough that delegation adds latency without adding clarity.
- Delegation is available, but not required when direct execution is already the better path.

### Child Unit Coordination
- From this layer, **spawnChild** creates an **L2** child unit. The child's task brief should include the project's absolute path and relevant context so the child can orient effectively.
- You have up to **9 coordination slots** for child units. All children are always visible.
- **Favor parallelism.** When work can be split into independent or semi-independent subtasks, spawning multiple L2 children to work concurrently is generally better than doing everything sequentially. Decompose work to increase concurrency and speed up overall progress.
- When new information is relevant to an existing child's current task, use **sendToChild** to incorporate it — even if the child is still active. The message will be queued and become available to that child. Choose the most relevant child rather than waiting for one to become idle.
- When new information starts a sufficiently separate subtask that does not fit any existing child, spawn a new child unit for it.
- When a child has yielded and is idle, you can reuse its slot by sending a new task via sendToChild rather than spawning a new child.

### Upward Communication
- You report and yield to your **L0 parent unit**. L0 is the coordinator and knowledge-space maintainer — it relies on your reports and yields to maintain coordination awareness, not to re-execute your work.
- When you produce detailed work results, save them to a .md file and include the absolute file path in your report or yield so L0 can reference it on demand.
- Significant modifications to shared knowledge artifacts (AGENT.md files, directory structure) should be surfaced via report or yield — L0 cannot directly observe file-system changes.`;
const LAYER_ORIENTATION_L2 = `
- You are currently at **L2**.
- This is the leaf execution layer.
- This layer can make direct progress with environment tools.
- This layer does not create child units.`;
const LAYER_ORIENTATION_BY_LEVEL = {
  L0: LAYER_ORIENTATION_L0,
  L1: LAYER_ORIENTATION_L1,
  L2: LAYER_ORIENTATION_L2
};
function buildLayerOrientation(level) {
  return LAYER_ORIENTATION_BY_LEVEL[level];
}
const AGENT_A_STYLE = `

## Your Cognitive Style: Agent A

### Strategy
- **Evidence evaluation**: Lenient — form tentative conclusions from partial evidence, explore possibilities
- **Reasoning organization**: Holist — grasp the big picture first, then fill in details
- **Temporal orientation**: Prospective — think about consequences and implications
- **Abstraction**: Mixed — iterate between abstract principles and concrete examples

### Operating Principles
1. Start with the overall picture, then add detail
2. Integrate multiple lines of evidence into a unified explanation
3. Explore multiple possible interpretations before converging
4. Mark your claims by modal type:
   - [Certain]: logically necessary claims
   - [Likely]: well-supported but not proven claims
   - [Possible]: plausible but speculative claims
5. When your partner raises valid concerns, substantively address them — do not deflect, repeat your prior position unchanged, or rush to agreement to maintain conversational flow
6. When you believe the discussion has converged sufficiently, or when the unit clearly needs upper-layer input before proceeding, call the **yield** tool with a clear summary or question`;
const AGENT_B_STYLE = `

## Your Cognitive Style: Agent B

### Strategy
- **Evidence evaluation**: Strict — require explicit evidence for each claim, seek disconfirmation
- **Reasoning organization**: Atomist — decompose claims into independently verifiable units
- **Temporal orientation**: Retrospective — trace how claims were derived, check each step
- **Abstraction**: Concrete-first — start from specific examples and data points

### Operating Principles
1. Decompose your partner's response into individual claims
2. For each substantive claim, ask: "What is the evidence for this?"
3. Seek disconfirmation: "If this claim were wrong, what would we expect to see?"
4. Mark each claim's reliability:
   - [Reliable]: strong evidence supports it
   - [Uncertain]: partial evidence, explain why
   - [Suspect]: lacking evidence or contradicted, explain why
5. When a pending proposal is presented, carefully evaluate whether it is accurate and complete. If you identify concerns, raise them in dialogue before voting — do not silently approve after internal verification. Only call **vote** APPROVE when your scrutiny is satisfied
6. You may also propose a **yield** yourself if you believe the discussion has converged, or if the unit should pause and ask the upper layer for missing information or judgment
7. When reviewing child work products, apply the same scrutiny discipline: identify gaps, inaccuracies, or misalignment with the assigned task before the unit accepts the output`;
const COGNITIVE_STYLES = {
  "agent-a": AGENT_A_STYLE,
  "agent-b": AGENT_B_STYLE
};
const COMPRESSION_SYSTEM_PROMPT = `## Elenchus Context Compression
You are refreshing a unit-level Memory Snapshot for an Elenchus deliberation unit.

Your job is to write a natural-language task-state snapshot for future turns.

## Inputs
- You may receive an earlier Memory Snapshot reference plus a Recent Raw Window of newer conversation history.
- Treat the earlier snapshot as compressed reference context, not as a verbatim transcript.
- Treat the recent raw window as the latest uncompressed context that should be integrated into the refreshed snapshot.
- Overlap between the earlier snapshot and the recent raw window is expected rather than erroneous.

## Output Requirements
- Write a single Memory Snapshot in natural language.
- The snapshot may be weakly structured, but it must not become a rigid schema or template dump.
- Prioritize task state over chat narration.
- Preserve unresolved issues, disagreements, constraints, and pending obligations when they still matter.
- Preserve uncertainty and confidence explicitly. Do not flatten tentative or conditional judgments into certainty.
- Respect the supplied preservation requirements, but remain a neutral organizer rather than taking a side in unresolved disputes.
- Write for continued work, not for archival display.
- Return only the Memory Snapshot text.`;
const KNOWLEDGE_VIEW_GUIDELINE_TEMPLATE = `

## Knowledge View
Your workspace root directory is: **{{WORKSPACE_ROOT}}**

Knowledge is not a separate storage system — it is a navigable cognitive view built on top of the file system.

Some directories contain an **AGENT.md** file. This is a local knowledge entry page that helps you understand the directory: what it is for, which contents matter most, where to start reading, and how it relates to other areas. AGENT.md files may reference each other across directories.

The **workspace root AGENT.md** has an expanded role: it is both the navigation hub for the entire workspace and the **cross-project persistent context** — the natural place to record user preferences, project conventions, and recurring expectations that should persist across sessions and be visible to all agents.

AGENT.md is not a configuration file, not a manifest, and not a behavioral constraint. It is a natural-language semantic entry point written for you. There is no enforced schema — different directories may organize their AGENT.md differently depending on what is most helpful.

You may create, update, or reference AGENT.md files as part of your normal work when doing so would improve the navigability and understandability of the workspace. This is a natural cognitive-housekeeping activity, not an extra compliance obligation. Maintain them when it genuinely helps future understanding; do not maintain them mechanically.

When you encounter a new directory within the workspace, check whether an AGENT.md exists. If it does, read it first to orient yourself. If it does not, the directory is still part of the workspace — you can explore it normally and consider whether an AGENT.md would be worth creating.

### Writing Guidance
AGENT.md should be a quick-orientation entry point, not exhaustive documentation. A reader should be able to build a directory-level understanding within seconds.
- **Good content**: directory purpose, key entry files, brief subdirectory descriptions, relationships to other areas, an \`Updated:\` date near the top. For the workspace root AGENT.md specifically: also user preferences, project conventions, and cross-project context that should be visible to all agents.
- **Avoid**: temporary task notes, detailed implementation logic, full API documentation, conversation logs, or mechanical per-file listings.
- **The workspace root AGENT.md is injected into your system prompt every turn.** Its length directly reduces the context budget available for conversation and reasoning. Keep it especially concise — overview, navigation, and essential cross-project context only. Content written here becomes visible to all agents across all layers, making it the most effective place to persist information that should propagate throughout the agent team.
- Update an AGENT.md when the directory's purpose or structure changes meaningfully, not after every small edit. Include an \`Updated:\` timestamp so future readers can gauge freshness.

### Agent Knowledge Model
You are a stateless compute unit — your runtime context (conversation history, unit state, compression snapshot) is maintained by the framework, not stored on the file system. The file system is a shared world that all agents read and write; no agent owns any directory. Your context window is your working staging area; the file system is for published knowledge. If an artifact has value, place it at a meaningful location; if it has no value, do not write it.

### File Paths in Communication
Absolute file paths appear naturally throughout agent communication — in dialogue, reports, yields, task briefs, and sendToChild messages. When you produce work results, save them to .md files and share the absolute path. When you reference documents from other areas, give the absolute path and describe the context in natural language (e.g., "that directory contains a previous analysis you may find useful — please review but do not modify the existing files there"). In communication, absolute paths are the norm — structured wikilink references belong inside .md documents, not in transient messages.

### Cross-Document References
When writing .md files — especially AGENT.md — use \`[[relative-path]]\` wikilink syntax to reference other files within the workspace. For example, \`[[framework-design/knowledge-view.md]]\` points to the knowledge-view design document, and \`[[skills/AGENT.md]]\` points to the skills region entry page. This makes reference relationships between documents detectable, so broken links and orphan pages can be found automatically.

Wikilink conventions:
- Paths are relative to the workspace root, not to the current file.
- The \`.md\` extension is optional: \`[[framework-design/knowledge-view]]\` and \`[[framework-design/knowledge-view.md]]\` are equivalent.
- You may use display text: \`[[framework-design/knowledge-view.md|Knowledge View Design]]\` shows as "Knowledge View Design" but links to the file.
- Only use wikilinks for references to files within the workspace. External resources use normal URLs.

Wikilinks are a document-level convention. In conversation, reports, yields, and messages, absolute paths remain appropriate — wikilinks are for the structured references that live inside .md files, not for transient communication.

When you create or update a .md file that discusses or relates to another area of the workspace, add a wikilink to the relevant file. This is part of normal cognitive housekeeping — like adding a cross-reference in a well-organized notebook. Do not add wikilinks mechanically to every path mention; add them where a reader would benefit from being able to follow the reference.

### Intermediate and Scratch Files
When your task does not involve a specific project directory and you need to produce intermediate artifacts (notes, analysis results, draft documents), create a descriptively named subdirectory under the workspace root (e.g., \`{{WORKSPACE_ROOT}}/research-topic-name/\`). This follows the same single-destination principle: the files go where the work naturally belongs. If the artifacts later prove unneeded, they can be cleaned up; if they prove valuable, they are already in a discoverable location.

### Knowledge Modification Awareness
You may create new files and make minor edits as part of normal work. However, significant modifications to existing shared knowledge — restructuring AGENT.md files, reorganizing directory layout, rewriting shared documents — should be surfaced to the parent unit via **report** or **yield**. The parent cannot directly observe file-system changes; it relies on your messages to maintain awareness of the workspace state. Minor edits and routine housekeeping do not require explicit notification.

### Single-Destination Knowledge Space
- **Knowledge has one destination: where the work naturally belongs.** There is no separate "global knowledge" directory. Write knowledge at meaningful locations in the project structure.
- **Workspace root** (**{{WORKSPACE_ROOT}}**): The agent team's working world root. Contains the navigation hub AGENT.md and framework state (\`.elenchus-state/\`). The coordinator (L0) uses this as its bash cwd. Not an agent write target for knowledge — knowledge goes where the work is.
- **Child projectRoot**: Each child agent's bash cwd is inferred from its task brief. Children operate on their project's actual file structure.
- Discovery happens through the message channel (report + absolute paths) and navigation (AGENT.md), not through storage partitioning.
- Use **absolute paths** for readFile and writeFile operations to avoid ambiguity.

### Conflict Awareness
Multiple agents may operate on the same shared file system. Conflict is explicit, not hidden — this is a feature, not a risk:
- **L0 coordination**: L0 assigns non-overlapping work scope through task briefs and monitors child progress.
- **Proposal-vote**: any write within a unit requires dual-agent approval, catching potentially problematic operations.
- **Git safety net**: if conflict occurs, git provides detection and recovery via \`git diff\` and \`git revert\`.
If you suspect your work might overlap with another unit's, mention it in your report or yield so L0 can coordinate.

### Change Tracking
If the project is a git repository, you can use \`git status\`, \`git diff\`, and \`git log\` via bash to understand what has changed. This is a natural use of environment tools, not a special integration point.

### Knowledge Space Boundary
Your **workspace root** is \`{{WORKSPACE_ROOT}}\`. You may read and write files anywhere on the host system when a task requires it, but knowledge-organization activities — creating or updating AGENT.md files, organizing knowledge structure — should stay within the working world accessible from the workspace root.

The workspace root AGENT.md, if present, is shown below as **Workspace Knowledge**.`;
function buildWorkspaceKnowledge(content) {
  if (!content) return "";
  return `

## Workspace Knowledge
The following is the content of the workspace root AGENT.md:

${content}`;
}
function readRootAgentMd(runDirectory) {
  try {
    return readFileSync(join(runDirectory, "AGENT.md"), "utf-8");
  } catch {
    return null;
  }
}
function buildSystemPrompt(agentId, level, workspaceRoot2, workspaceKnowledge) {
  const knowledgeViewGuideline = KNOWLEDGE_VIEW_GUIDELINE_TEMPLATE.replace(/\{\{WORKSPACE_ROOT\}\}/g, workspaceRoot2);
  return buildGuideline() + buildLayerOrientation(level) + knowledgeViewGuideline + buildWorkspaceKnowledge(workspaceKnowledge ?? null) + COGNITIVE_STYLES[agentId];
}
function buildCompressionSystemPrompt() {
  return COMPRESSION_SYSTEM_PROMPT;
}
const CHARS_PER_TOKEN = 3.5;
function tokensToChars(tokens) {
  return Math.ceil(tokens * CHARS_PER_TOKEN);
}
function charsToTokens(chars) {
  return Math.floor(chars / CHARS_PER_TOKEN);
}
function estimateMessageChars$1(message) {
  switch (message.kind) {
    case "incoming_message":
    case "agent_message":
    case "system_message":
      return message.content.length + 32;
    case "upward_message":
      return message.content.length + 48;
    case "proposal_message":
      return message.toolName.length + message.proposedStep.length + JSON.stringify(message.args).length + 64;
    case "vote_message":
      return message.reason.length + 48;
    case "tool_result_message":
      return message.toolName.length + message.output.length + 64;
    case "child_report_message":
      return message.childId.length + message.content.length + 64;
    case "child_commit_view_message":
      return message.content.length + 64;
  }
}
function estimateMessagesChars$1(messages) {
  return messages.reduce((total, message) => total + estimateMessageChars$1(message), 0);
}
function clamp$2(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function findTailStartIndexWithinChars(messages, targetChars) {
  if (messages.length === 0) {
    return 0;
  }
  let chars = 0;
  let start = messages.length - 1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const estimated = estimateMessageChars$1(messages[index]);
    if (index < messages.length - 1 && chars + estimated > targetChars) {
      break;
    }
    chars += estimated;
    start = index;
  }
  return start;
}
function createTurnContextBudgetPlan(input) {
  const baseRecentRawStartIndex = clamp$2(
    input.baseRecentRawStartSeq - input.currentSequenceStart,
    0,
    input.visibleMessages.length
  );
  const baseRecentRawMessages = input.visibleMessages.slice(baseRecentRawStartIndex);
  const estimatedRecentRawChars = estimateMessagesChars$1(baseRecentRawMessages);
  const shouldTruncate = estimatedRecentRawChars > input.capacityGuardCharLimit;
  const relativeStartIndex = shouldTruncate ? findTailStartIndexWithinChars(baseRecentRawMessages, input.capacityGuardCharLimit) : 0;
  const recentRawStartSeq = input.baseRecentRawStartSeq + relativeStartIndex;
  return {
    recentRawStartSeq,
    visibleEndSeq: input.currentSequenceStart + input.visibleMessages.length,
    newlyVisibleSeq: input.newlyVisibleMessages.length > 0 ? input.currentSequenceStart + (input.visibleMessages.length - input.newlyVisibleMessages.length) : null,
    compressionReminderShown: input.compressionReminderShown,
    compressionReminderChars: input.compressionReminderChars,
    compressionReminderThresholdChars: input.compressionReminderThresholdChars,
    truncationApplied: shouldTruncate,
    truncationReason: shouldTruncate ? "capacity_guard" : "none",
    truncationLevel: shouldTruncate ? 1 : 0
  };
}
function tightenTurnContextBudgetPlan(input) {
  const currentRecentRawStartIndex = clamp$2(
    input.currentPlan.recentRawStartSeq - input.currentSequenceStart,
    0,
    input.visibleMessages.length
  );
  const currentRecentRawMessages = input.visibleMessages.slice(currentRecentRawStartIndex);
  if (currentRecentRawMessages.length <= 1) {
    return null;
  }
  const relativeStartIndex = findTailStartIndexWithinChars(currentRecentRawMessages, input.targetRecentRawChars);
  const nextRecentRawStartSeq = input.currentPlan.recentRawStartSeq + relativeStartIndex;
  if (nextRecentRawStartSeq <= input.currentPlan.recentRawStartSeq) {
    return null;
  }
  return {
    ...input.currentPlan,
    recentRawStartSeq: nextRecentRawStartSeq,
    truncationApplied: true,
    truncationReason: "provider_reject",
    truncationLevel: input.currentPlan.truncationLevel + 1
  };
}
const DISPLAY_NAMES = {
  "agent-a": "Agent A",
  "agent-b": "Agent B",
  incoming: "Incoming Message",
  system: "System"
};
function getDisplayName(author) {
  return DISPLAY_NAMES[author] ?? author;
}
function renderProposalDetail(proposal) {
  switch (proposal.toolName) {
    case "yield":
      return `The proposed upward handoff content is:

---
${proposal.args.content}
---`;
    case "report":
      return `The proposed upward coordination message is:

---
${proposal.args.content}
---`;
    case "compressContext":
      return `Preservation requirements:
---
${String(proposal.args.requirements)}
---`;
    case "bash":
      return `Command: \`${proposal.args.command}\``;
    case "readFile": {
      const offset = proposal.args.offset;
      const limit = proposal.args.limit;
      const hasRange = offset !== void 0 || limit !== void 0;
      const start = offset ?? 1;
      const end = limit !== void 0 ? start + limit - 1 : "end";
      const rangeInfo = hasRange ? ` (lines ${start}-${end})` : "";
      return `File path: \`${proposal.args.path}\`${rangeInfo}`;
    }
    case "writeFile":
      return `File path: \`${proposal.args.path}\`
Content:
---
${String(proposal.args.content)}
---`;
    case "sleep":
      return `Timeout: ${proposal.args.timeoutSeconds}s`;
    case "spawnChild": {
      return `Task:
---
${String(proposal.args.task)}
---`;
    }
    case "sendToChild":
      return `Child: ${proposal.args.childId}
Message:
---
${String(proposal.args.message)}
---`;
    default:
      return `Arguments:
${JSON.stringify(proposal.args, null, 2) ?? "{}"}`;
  }
}
function renderProposalMessage(message) {
  const authorName = getDisplayName(message.authoredBy);
  return {
    role: "user",
    content: `[Public Fact][Proposal]
Author: ${authorName}
Proposal ID: ${message.id}
Tool: ${message.toolName}
Status: ${message.status}
Proposed step: ${message.proposedStep}
${renderProposalDetail(message)}`,
    timestamp: message.timestamp
  };
}
function renderVoteMessage(message) {
  const voterName = getDisplayName(message.authoredBy);
  return {
    role: "user",
    content: `[Public Fact][Vote]
Voter: ${voterName}
Proposal ID: ${message.proposalId}
Decision: ${message.approve ? "APPROVE" : "REJECT"}
Reason: ${message.reason}`,
    timestamp: message.timestamp
  };
}
function renderConversationMessage(message) {
  if (message.kind === "proposal_message") {
    return renderProposalMessage(message);
  }
  if (message.kind === "vote_message") {
    return renderVoteMessage(message);
  }
  if (message.kind === "tool_result_message") {
    return {
      role: "user",
      content: `[Public Fact][Tool Result]
Tool result for ${message.toolName} on proposal ${message.proposalId}:
Success: ${message.success ? "true" : "false"}
Duration: ${message.durationMs}ms
Output:
${message.output}`,
      timestamp: message.timestamp
    };
  }
  if (message.kind === "upward_message") {
    return {
      role: "user",
      content: `[Public Fact][Upward Message]
Delivery mode: ${message.deliveryMode}${message.deliveryMode === "yield" ? " (handoff and pause)" : " (coordination and continue)"}
Content:
${message.content}`,
      timestamp: message.timestamp
    };
  }
  if (message.kind === "child_report_message") {
    return {
      role: "user",
      content: `[Public Fact][Child Report]
Child: ${message.childId}
Delivery mode: ${message.deliveryMode}
Content:
${message.content}`,
      timestamp: message.timestamp
    };
  }
  if (message.kind === "system_message") {
    return {
      role: "user",
      content: `[Public Fact][Unit Runtime]
${message.content}`,
      timestamp: message.timestamp
    };
  }
  if (message.kind === "child_commit_view_message") {
    return {
      role: "user",
      content: message.content,
      timestamp: message.timestamp
    };
  }
  const prefix = getDisplayName(message.authoredBy);
  const content = "content" in message ? message.content : "";
  return {
    role: "user",
    content: `[${prefix}]: ${content}`,
    timestamp: message.timestamp
  };
}
class ConversationProjector {
  projectVisibleMessages(messages) {
    return messages.map((message) => renderConversationMessage(message));
  }
  buildMemorySnapshotMessage(snapshot) {
    return {
      role: "user",
      content: `[Context Snapshot][Memory Snapshot]
The following Memory Snapshot was compressed from earlier conversation history. Treat it as reference context rather than verbatim transcript. Some recent raw messages may overlap with it.

${snapshot.content}`,
      timestamp: snapshot.createdAt
    };
  }
  buildNewlyVisibleBoundaryOverlay(agentId, count) {
    const agentName = getDisplayName(agentId);
    const lines = [
      "[Context Boundary]",
      count === 1 ? `The message below this marker became newly visible in this turn for ${agentName}.` : `${count} messages below this marker became newly visible in this turn for ${agentName}.`,
      count === 1 ? `${agentName} should prioritize interpreting this newest item in light of the earlier shared history above.` : `${agentName} should prioritize interpreting these newest items in light of the earlier shared history above.`
    ];
    return {
      role: "user",
      content: lines.join("\n"),
      timestamp: Date.now()
    };
  }
  buildCompressionReminderOverlay(agentId, estimatedChars, thresholdChars, contextWindowTokens) {
    const agentName = getDisplayName(agentId);
    const estimatedTokens = charsToTokens(estimatedChars);
    const pct = contextWindowTokens ? ` (approximately ${Math.round(estimatedTokens / contextWindowTokens * 100)}% of model context capacity)` : "";
    return {
      role: "user",
      content: `[Context Reminder]
The recent raw context visible to ${agentName} is estimated at about ${estimatedTokens} tokens${pct}, above the compression reminder threshold. Context compression is worth considering, but this is a reminder rather than an instruction to compress immediately.`,
      timestamp: Date.now()
    };
  }
  buildProposalNotification(proposal, proposerName, voterName) {
    return {
      role: "user",
      content: `[Directive]
${voterName} must now vote on ${proposerName}'s pending ${proposal.toolName} proposal.
${voterName} may only call the **vote** tool with APPROVE or REJECT and a reason in this turn.`,
      timestamp: Date.now()
    };
  }
  buildChildCommitViewMessage(agentId, childCommitViews) {
    if (childCommitViews.length === 0) {
      return null;
    }
    const agentName = getDisplayName(agentId);
    const lines = [
      "[Context Snapshot]",
      `The following currently visible child unit commit log snapshot is visible to ${agentName} (accepted steps only; not real-time activity):`
    ];
    for (const view of childCommitViews) {
      lines.push(`- ${view.childId} [state: ${view.state}]`);
      if (view.committedSteps.length === 0) {
        lines.push("  - no committed steps yet");
        continue;
      }
      for (const step of view.committedSteps) {
        const proposerName = getDisplayName(step.proposedBy);
        lines.push(`  - ${proposerName} via ${step.toolName}: ${step.proposedStep}`);
      }
    }
    return {
      role: "user",
      content: lines.join("\n"),
      timestamp: Date.now()
    };
  }
}
const AGENT_NAMES$1 = {
  "agent-a": "Agent A",
  "agent-b": "Agent B"
};
function clamp$1(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function assembleTurnContext(input) {
  const projector = new ConversationProjector();
  const tools = getBuiltInToolList(
    input.pendingProposal !== null && input.pendingProposal.proposer !== input.agentId,
    input.level,
    input.hasChildren,
    input.canSpawnChild
  );
  const recentRawStartIndex = clamp$1(
    input.budgetPlan.recentRawStartSeq - (input.budgetPlan.visibleEndSeq - input.visibleMessages.length),
    0,
    input.visibleMessages.length
  );
  const recentRawMessages = input.visibleMessages.slice(recentRawStartIndex);
  const recentNewMessageIds = new Set(input.newlyVisibleMessages.map((message) => message.id));
  const firstRecentNewIndex = recentRawMessages.findIndex((message) => recentNewMessageIds.has(message.id));
  const oldRecentRawMessages = firstRecentNewIndex === -1 ? recentRawMessages : recentRawMessages.slice(0, firstRecentNewIndex);
  const newRecentRawMessages = firstRecentNewIndex === -1 ? [] : recentRawMessages.slice(firstRecentNewIndex);
  const messages = [];
  if (input.memorySnapshot) {
    messages.push(projector.buildMemorySnapshotMessage(input.memorySnapshot));
  }
  messages.push(...projector.projectVisibleMessages(oldRecentRawMessages));
  if (newRecentRawMessages.length > 0) {
    messages.push(projector.buildNewlyVisibleBoundaryOverlay(input.agentId, newRecentRawMessages.length));
    messages.push(...projector.projectVisibleMessages(newRecentRawMessages));
  }
  if (input.budgetPlan.compressionReminderShown && input.budgetPlan.compressionReminderChars !== null && input.budgetPlan.compressionReminderThresholdChars !== null) {
    messages.push(projector.buildCompressionReminderOverlay(
      input.agentId,
      input.budgetPlan.compressionReminderChars,
      input.budgetPlan.compressionReminderThresholdChars,
      input.contextWindowTokens
    ));
  }
  if (input.pendingProposal && input.pendingProposal.proposer !== input.agentId) {
    const proposerName = AGENT_NAMES$1[input.pendingProposal.proposer] ?? input.pendingProposal.proposer;
    const voterName = AGENT_NAMES$1[input.agentId] ?? input.agentId;
    messages.push(projector.buildProposalNotification(input.pendingProposal, proposerName, voterName));
  }
  return {
    plan: {
      unitId: input.unitId,
      agentId: input.agentId,
      level: input.level,
      visibleEndSeq: input.budgetPlan.visibleEndSeq,
      recentRawStartSeq: input.budgetPlan.recentRawStartSeq,
      newlyVisibleSeq: input.budgetPlan.newlyVisibleSeq,
      memorySnapshotRowid: input.memorySnapshotRowid,
      agentMdRowid: input.agentMdRowid,
      hasPendingFromOther: input.pendingProposal !== null && input.pendingProposal.proposer !== input.agentId,
      hasChildren: input.hasChildren,
      canSpawnChild: input.canSpawnChild,
      compressionReminderShown: input.budgetPlan.compressionReminderShown,
      compressionReminderChars: input.budgetPlan.compressionReminderChars,
      compressionReminderThresholdChars: input.budgetPlan.compressionReminderThresholdChars,
      truncationApplied: input.budgetPlan.truncationApplied,
      truncationReason: input.budgetPlan.truncationReason,
      truncationLevel: input.budgetPlan.truncationLevel,
      effectiveTurn: input.effectiveTurn
    },
    llmContext: {
      systemPrompt: buildSystemPrompt(input.agentId, input.level, input.workspaceRoot, input.workspaceKnowledge),
      messages,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }))
    },
    tools
  };
}
const DEFAULT_REMINDER_THRESHOLD_CHARS$1 = 12e4;
const DEFAULT_RECENT_RAW_TARGET_CHARS$1 = 24e3;
const DEFAULT_MAX_RETRIES$1 = 1;
let nextCompressionTaskId = 0;
function generateCompressionTaskId() {
  nextCompressionTaskId += 1;
  return `compression-${nextCompressionTaskId}`;
}
function estimateMessageChars(message) {
  switch (message.kind) {
    case "incoming_message":
    case "agent_message":
    case "system_message":
      return message.content.length + 32;
    case "upward_message":
      return message.content.length + 48;
    case "proposal_message":
      return message.toolName.length + message.proposedStep.length + JSON.stringify(message.args).length + 64;
    case "vote_message":
      return message.reason.length + 48;
    case "tool_result_message":
      return message.toolName.length + message.output.length + 64;
    case "child_report_message":
      return message.childId.length + message.content.length + 64;
    case "child_commit_view_message":
      return message.content.length + 64;
  }
}
function estimateMessagesChars(messages) {
  return messages.reduce((total, message) => total + estimateMessageChars(message), 0);
}
function findRecentRawStartIndex(messages, targetChars) {
  if (messages.length === 0) {
    return 0;
  }
  let chars = 0;
  let start = messages.length - 1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const estimated = estimateMessageChars(messages[index]);
    if (index < messages.length - 1 && chars + estimated > targetChars) {
      break;
    }
    chars += estimated;
    start = index;
  }
  return start;
}
function cloneMemorySnapshot(snapshot) {
  return snapshot ? { ...snapshot } : null;
}
function cloneActiveCompressionTask(task) {
  return {
    ...task,
    existingMemorySnapshot: cloneMemorySnapshot(task.existingMemorySnapshot),
    sourceMessages: task.sourceMessages.map((message) => ({ ...message }))
  };
}
function toActiveCompressionTaskSnapshot(task) {
  if (!task) {
    return null;
  }
  return {
    id: task.id,
    requirements: task.requirements,
    sourceMessageCount: task.sourceMessages.length,
    attemptNumber: task.attemptNumber,
    maxAttempts: task.maxAttempts,
    startedAt: task.startedAt
  };
}
class CompressionTaskManager {
  activeTask = null;
  memorySnapshot = null;
  recentRawStartIndex = 0;
  reminderThresholdChars;
  recentRawTargetChars;
  maxRetries;
  modelInfo;
  constructor(options) {
    this.modelInfo = options?.modelInfo ?? null;
    const defaultReminderThreshold = this.modelInfo ? tokensToChars(Math.floor(this.modelInfo.contextWindowTokens * 0.75)) : DEFAULT_REMINDER_THRESHOLD_CHARS$1;
    const defaultRecentRawTarget = this.modelInfo ? tokensToChars(Math.floor(this.modelInfo.contextWindowTokens * 0.5)) : DEFAULT_RECENT_RAW_TARGET_CHARS$1;
    this.reminderThresholdChars = options?.reminderThresholdChars ?? defaultReminderThreshold;
    this.recentRawTargetChars = options?.recentRawTargetChars ?? defaultRecentRawTarget;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES$1;
  }
  getMemorySnapshot() {
    return this.memorySnapshot ? { ...this.memorySnapshot } : null;
  }
  hasActiveTask() {
    return this.activeTask !== null;
  }
  getReminderThresholdChars() {
    return this.reminderThresholdChars;
  }
  getRecentRawTargetChars() {
    return this.recentRawTargetChars;
  }
  getRecentRawStartIndex() {
    return this.recentRawStartIndex;
  }
  getModelInfo() {
    return this.modelInfo;
  }
  getCapacityGuardCharLimit() {
    if (!this.modelInfo) return this.recentRawTargetChars;
    return tokensToChars(Math.floor(this.modelInfo.contextWindowTokens * 0.9));
  }
  getRecentRawMessages(visibleMessages) {
    const safeStart = Math.min(this.recentRawStartIndex, visibleMessages.length);
    return visibleMessages.slice(safeStart);
  }
  estimateRecentRawChars(visibleMessages) {
    return estimateMessagesChars(this.getRecentRawMessages(visibleMessages));
  }
  shouldShowReminder(visibleMessages) {
    return !this.hasActiveTask() && this.estimateRecentRawChars(visibleMessages) >= this.reminderThresholdChars;
  }
  exportSnapshot() {
    return {
      activeTask: toActiveCompressionTaskSnapshot(this.activeTask),
      memorySnapshot: this.memorySnapshot ? { ...this.memorySnapshot } : null,
      recentRawStartIndex: this.recentRawStartIndex,
      reminderThresholdChars: this.reminderThresholdChars,
      recentRawTargetChars: this.recentRawTargetChars,
      maxRetries: this.maxRetries
    };
  }
  loadSnapshot(snapshot) {
    this.memorySnapshot = snapshot.memorySnapshot ? { ...snapshot.memorySnapshot } : null;
    this.recentRawStartIndex = snapshot.recentRawStartIndex;
    this.reminderThresholdChars = snapshot.reminderThresholdChars;
    this.recentRawTargetChars = snapshot.recentRawTargetChars;
    this.maxRetries = snapshot.maxRetries;
    this.activeTask = snapshot.activeTask ? {
      id: snapshot.activeTask.id,
      requirements: snapshot.activeTask.requirements,
      existingMemorySnapshot: null,
      sourceMessages: [],
      attemptNumber: snapshot.activeTask.attemptNumber,
      maxAttempts: snapshot.activeTask.maxAttempts,
      startedAt: snapshot.activeTask.startedAt
    } : null;
  }
  startTask(requirements, sourceMessages, existingMemorySnapshot) {
    if (this.activeTask) {
      return {
        ok: false,
        error: `A context compression task is already active (${this.activeTask.id}). Duplicate launches are not allowed.`
      };
    }
    const clonedSourceMessages = sourceMessages.map((message) => ({ ...message }));
    const clonedExistingMemorySnapshot = cloneMemorySnapshot(existingMemorySnapshot);
    if (clonedSourceMessages.length === 0 && !clonedExistingMemorySnapshot?.content.trim()) {
      return {
        ok: false,
        error: "No context is currently available to compress. Start a compression task only when the unit has an existing Memory Snapshot or recent raw conversation history."
      };
    }
    const task = {
      id: generateCompressionTaskId(),
      requirements: requirements.trim(),
      existingMemorySnapshot: clonedExistingMemorySnapshot,
      sourceMessages: clonedSourceMessages,
      attemptNumber: 1,
      maxAttempts: this.maxRetries + 1,
      startedAt: Date.now()
    };
    this.activeTask = task;
    return { ok: true, task: cloneActiveCompressionTask(task) };
  }
  registerSuccess(content, currentMessages) {
    if (!this.activeTask) {
      throw new Error("Cannot register compression success without an active task");
    }
    const snapshot = {
      content: content.trim(),
      sourceMessageCount: this.activeTask.sourceMessages.length,
      requirements: this.activeTask.requirements,
      createdAt: Date.now()
    };
    this.memorySnapshot = snapshot;
    this.recentRawStartIndex = findRecentRawStartIndex(currentMessages, this.recentRawTargetChars);
    this.activeTask = null;
    return { ...snapshot };
  }
  registerFailure() {
    if (!this.activeTask) {
      throw new Error("Cannot register compression failure without an active task");
    }
    if (this.activeTask.attemptNumber < this.activeTask.maxAttempts) {
      this.activeTask = {
        ...this.activeTask,
        attemptNumber: this.activeTask.attemptNumber + 1
      };
      return {
        shouldRetry: true,
        task: cloneActiveCompressionTask(this.activeTask)
      };
    }
    this.activeTask = null;
    return { shouldRetry: false };
  }
}
let nextConversationMessageId = 0;
function generateConversationMessageId() {
  return `msg-${++nextConversationMessageId}-${Date.now()}`;
}
class ConversationLedger {
  messages = [];
  sequenceStart = 1;
  totalMessages = 0;
  get currentSequenceStart() {
    return this.sequenceStart;
  }
  get currentMessageCount() {
    return this.messages.length;
  }
  cursors = {
    "agent-a": 0,
    "agent-b": 0
  };
  sink;
  suppressPersistence = false;
  constructor(sink) {
    this.sink = sink ?? {
      onMessageCreated() {
      },
      onMessageUpdated() {
      }
    };
  }
  appendMessage(message) {
    const seq = this.sequenceStart + this.messages.length;
    this.messages.push(message);
    this.totalMessages += 1;
    if (!this.suppressPersistence) {
      this.sink.onMessageCreated(message, seq);
    }
  }
  appendIncomingMessage(content, meta) {
    const message = {
      id: generateConversationMessageId(),
      kind: "incoming_message",
      authoredBy: "incoming",
      content,
      timestamp: Date.now(),
      turnAuthored: meta.turnAuthored,
      visibleFromTurn: meta.visibleFromTurn
    };
    this.appendMessage(message);
    return message;
  }
  appendUpwardMessage(message) {
    const entry = {
      id: generateConversationMessageId(),
      kind: "upward_message",
      authoredBy: "unit",
      deliveryMode: message.deliveryMode,
      content: message.content,
      timestamp: Date.now(),
      turnAuthored: message.turnAuthored,
      visibleFromTurn: message.visibleFromTurn
    };
    this.appendMessage(entry);
    return entry;
  }
  appendAgentMessage(agent, content, meta) {
    const message = {
      id: generateConversationMessageId(),
      kind: "agent_message",
      authoredBy: agent,
      content,
      timestamp: Date.now(),
      turnAuthored: meta.turnAuthored,
      visibleFromTurn: meta.visibleFromTurn
    };
    this.appendMessage(message);
    return message;
  }
  appendProposalMessage(proposal) {
    const existingPendingProposal = this.getPendingProposal();
    if (existingPendingProposal) {
      throw new Error(`Cannot append proposal ${proposal.toolName}; proposal ${existingPendingProposal.id} is still pending`);
    }
    const message = {
      id: generateConversationMessageId(),
      kind: "proposal_message",
      authoredBy: proposal.authoredBy,
      toolName: proposal.toolName,
      args: proposal.args,
      proposedStep: proposal.proposedStep,
      timestamp: Date.now(),
      turnAuthored: proposal.turnAuthored,
      visibleFromTurn: proposal.visibleFromTurn,
      status: "pending"
    };
    this.appendMessage(message);
    return message;
  }
  appendVoteMessage(vote) {
    const message = {
      id: generateConversationMessageId(),
      kind: "vote_message",
      authoredBy: vote.voter,
      proposalId: vote.proposalId,
      approve: vote.approve,
      reason: vote.reason,
      timestamp: Date.now(),
      turnAuthored: vote.turnAuthored,
      visibleFromTurn: vote.visibleFromTurn
    };
    this.appendMessage(message);
    return message;
  }
  appendToolResultMessage(result) {
    const message = {
      id: generateConversationMessageId(),
      kind: "tool_result_message",
      authoredBy: "system",
      proposalId: result.proposalId,
      toolName: result.toolName,
      success: result.success,
      output: result.output,
      durationMs: result.durationMs,
      timestamp: Date.now(),
      turnAuthored: result.turnAuthored,
      visibleFromTurn: result.visibleFromTurn
    };
    this.appendMessage(message);
    return message;
  }
  appendChildReportMessage(report) {
    const message = {
      id: generateConversationMessageId(),
      kind: "child_report_message",
      authoredBy: "system",
      childId: report.childId,
      deliveryMode: report.deliveryMode,
      content: report.content,
      timestamp: Date.now(),
      turnAuthored: report.turnAuthored,
      visibleFromTurn: report.visibleFromTurn
    };
    this.appendMessage(message);
    return message;
  }
  appendSystemMessage(content, meta) {
    const message = {
      id: generateConversationMessageId(),
      kind: "system_message",
      authoredBy: "system",
      content,
      timestamp: Date.now(),
      turnAuthored: meta.turnAuthored,
      visibleFromTurn: meta.visibleFromTurn
    };
    this.appendMessage(message);
    return message;
  }
  appendChildCommitViewMessage(content, meta) {
    const message = {
      id: generateConversationMessageId(),
      kind: "child_commit_view_message",
      authoredBy: "system",
      content,
      timestamp: Date.now(),
      turnAuthored: meta.turnAuthored,
      visibleFromTurn: meta.visibleFromTurn
    };
    this.appendMessage(message);
    return message;
  }
  readVisibleSnapshotForAgent(agent, turn) {
    const visibleEnd = this.findVisibleEndIndex(turn);
    const start = this.cursors[agent];
    const snapshot = {
      visibleMessages: this.messages.slice(0, visibleEnd),
      newlyVisibleMessages: this.messages.slice(start, visibleEnd)
    };
    this.cursors[agent] = visibleEnd;
    return snapshot;
  }
  readNewForAgent(agent, turn) {
    return this.readVisibleSnapshotForAgent(agent, turn).newlyVisibleMessages;
  }
  peekNewForAgent(agent, turn) {
    const start = this.cursors[agent];
    const end = this.findVisibleEndIndex(turn);
    return this.messages.slice(start, end);
  }
  hasNewMessages(agent, turn) {
    const start = this.cursors[agent];
    return start < this.findVisibleEndIndex(turn);
  }
  getProposalById(proposalId) {
    const message = this.messages.find((entry) => entry.kind === "proposal_message" && entry.id === proposalId);
    return message;
  }
  getPendingProposal() {
    let pendingProposal = null;
    for (const message of this.messages) {
      if (message.kind !== "proposal_message" || message.status !== "pending") {
        continue;
      }
      if (pendingProposal) {
        throw new Error(`Multiple pending proposals detected: ${pendingProposal.id} and ${message.id}`);
      }
      pendingProposal = message;
    }
    return pendingProposal;
  }
  getPendingProposalView() {
    const proposal = this.getPendingProposal();
    if (!proposal) {
      return null;
    }
    return {
      proposer: proposal.authoredBy,
      toolName: proposal.toolName,
      args: proposal.args,
      proposedStep: proposal.proposedStep,
      messageId: proposal.id
    };
  }
  hasPendingProposal() {
    return this.getPendingProposal() !== null;
  }
  markProposalApproved(proposalId) {
    return this.updateProposalStatus(proposalId, "approved");
  }
  markProposalRejected(proposalId) {
    return this.updateProposalStatus(proposalId, "rejected");
  }
  markProposalSuperseded(proposalId) {
    return this.updateProposalStatus(proposalId, "superseded");
  }
  supersedeAllPendingProposals() {
    let count = 0;
    for (const message of this.messages) {
      if (message.kind === "proposal_message" && message.status === "pending") {
        message.status = "superseded";
        this.pendingStatusUpdates.add(message.id);
        count++;
        if (!this.suppressPersistence) {
          this.sink.onMessageUpdated(message);
        }
      }
    }
    return count;
  }
  readAll() {
    return this.messages;
  }
  exportSnapshot() {
    return {
      sequenceStart: this.sequenceStart,
      totalMessages: this.totalMessages,
      messages: this.messages.map((message) => ({ ...message })),
      cursors: { ...this.cursors }
    };
  }
  loadSnapshot(snapshot) {
    this.suppressPersistence = true;
    try {
      this.sequenceStart = snapshot.sequenceStart;
      this.totalMessages = snapshot.totalMessages;
      this.messages = snapshot.messages.map((message) => ({ ...message }));
      this.cursors = { ...snapshot.cursors };
      this.pendingStatusUpdates.clear();
    } finally {
      this.suppressPersistence = false;
    }
  }
  pendingStatusUpdates = /* @__PURE__ */ new Set();
  flushPendingUpdates() {
    for (const id of this.pendingStatusUpdates) {
      const message = this.messages.find((m) => m.id === id);
      if (message && message.kind === "proposal_message") {
        this.sink.onMessageUpdated(message);
      }
    }
    this.pendingStatusUpdates.clear();
  }
  toPendingProposal(proposalId) {
    const proposal = this.getProposalById(proposalId);
    if (!proposal || proposal.status !== "pending") {
      return null;
    }
    return {
      proposer: proposal.authoredBy,
      toolName: proposal.toolName,
      args: proposal.args,
      proposedStep: proposal.proposedStep,
      messageId: proposal.id
    };
  }
  updateProposalStatus(proposalId, status) {
    const proposal = this.getProposalById(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    if (proposal.status !== "pending") {
      throw new Error(`Proposal ${proposalId} is ${proposal.status}; cannot transition to ${status}`);
    }
    proposal.status = status;
    this.pendingStatusUpdates.add(proposalId);
    if (!this.suppressPersistence) {
      this.sink.onMessageUpdated(proposal);
    }
    return proposal;
  }
  findVisibleEndIndex(turn) {
    let end = 0;
    while (end < this.messages.length && this.messages[end].visibleFromTurn <= turn) {
      end++;
    }
    return end;
  }
}
const AGENT_NAMES = {
  "agent-a": "Agent A",
  "agent-b": "Agent B"
};
class DeliberationUnit {
  state = "idle";
  unitId;
  ledger;
  projector;
  compressionManager;
  agentA;
  agentB;
  loopRunning = false;
  level;
  llmClient;
  toolExecutor;
  turnCounter = 0;
  onSystemEvent;
  scope;
  executingFromState = null;
  children = /* @__PURE__ */ new Map();
  childCounter = 0;
  static MAX_CHILDREN = 9;
  sleepTimer = null;
  sleepDeadlineMs = null;
  consecutiveEmptyTurns = 0;
  commitLog = [];
  onDurableStateChange;
  suppressDurableStateChangeNotifications = false;
  messagePersistenceSink;
  contextPersistenceSink;
  workspaceRoot;
  activeRecipeId = null;
  projectRoot;
  static MAX_EMPTY_TURNS = 4;
  static CHILD_COMMIT_VIEW_LIMIT = 3;
  static COMPRESSION_MAX_TOKENS = 4096;
  static DEFAULT_LLM_TIMEOUT_MS = 18e4;
  static DEFAULT_TOOL_TIMEOUT_MS = 3e5;
  llmTimeoutMs;
  toolTimeoutMs;
  constructor(options) {
    this.level = options.level ?? "L0";
    this.llmClient = options.llmClient;
    this.toolExecutor = options.toolExecutor;
    this.llmTimeoutMs = options.llmTimeoutMs ?? DeliberationUnit.DEFAULT_LLM_TIMEOUT_MS;
    this.toolTimeoutMs = options.toolTimeoutMs ?? DeliberationUnit.DEFAULT_TOOL_TIMEOUT_MS;
    this.workspaceRoot = options.workspaceRoot;
    this.projectRoot = options.projectRoot;
    this.unitId = options.unitId ?? DeliberationUnit.buildUnitId(this.level, options.path ?? []);
    this.ledger = new ConversationLedger(options.messagePersistenceSink);
    this.projector = new ConversationProjector();
    this.compressionManager = new CompressionTaskManager({
      modelInfo: this.llmClient.getModelInfo()
    });
    this.agentA = new AgentTurn("agent-a", this.llmClient);
    this.agentB = new AgentTurn("agent-b", this.llmClient);
    this.onSystemEvent = options.onSystemEvent ?? (() => {
    });
    this.onDurableStateChange = options.onDurableStateChange ?? (() => {
    });
    this.messagePersistenceSink = options.messagePersistenceSink;
    this.contextPersistenceSink = options.contextPersistenceSink;
    this.scope = {
      level: this.level,
      path: options.path ?? []
    };
  }
  injectUserMessage(content) {
    this.clearSleepState();
    this.ledger.appendIncomingMessage(content, this.buildDeferredVisibilityMeta());
    this.notifyDurableStateChange();
    this.emit({ type: "incoming-message", scope: this.scope, content });
    console.log(`[DU:${this.unitId}] injectUserMessage: state=${this.state}, loopRunning=${this.loopRunning}`);
    if (this.state === "idle" && !this.loopRunning) {
      this.transition(this.state, "turn-a");
      this.loopRunning = true;
      console.log(`[DU:${this.unitId}] Starting runLoop from idle → turn-a`);
      this.runLoop().catch((err) => {
        console.error(`[DU:${this.unitId}] runLoop crashed:`, err);
        this.emit({ type: "error", scope: this.scope, message: `Deliberation loop crashed: ${err}` });
      }).finally(() => {
        console.log(`[DU:${this.unitId}] runLoop finished, state=${this.state}`);
        this.loopRunning = false;
      });
    }
  }
  getState() {
    return this.state;
  }
  getUnitId() {
    return this.unitId;
  }
  getLevel() {
    return this.level;
  }
  getOnSystemEvent() {
    return this.onSystemEvent;
  }
  setOnSystemEvent(handler) {
    this.onSystemEvent = handler;
  }
  findUnitById(unitId) {
    if (this.unitId === unitId) {
      return this;
    }
    for (const child of this.children.values()) {
      const found = child.findUnitById(unitId);
      if (found) {
        return found;
      }
    }
    return null;
  }
  appendSystemNotice(content) {
    this.ledger.appendSystemMessage(content, this.buildDeferredVisibilityMeta());
    this.notifyDurableStateChange();
  }
  getCommittedSteps(limit = DeliberationUnit.CHILD_COMMIT_VIEW_LIMIT) {
    if (limit <= 0) {
      return [];
    }
    return this.commitLog.slice(-limit);
  }
  close() {
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
    for (const child of this.children.values()) {
      child.close();
    }
  }
  exportSnapshot() {
    const children = [...this.children.entries()].map(([childId, child]) => ({
      childId,
      snapshot: child.exportSnapshot()
    }));
    return {
      unitId: this.unitId,
      level: this.level,
      path: [...this.scope.path],
      workspaceRoot: this.workspaceRoot,
      projectRoot: this.projectRoot,
      state: this.state,
      turnCounter: this.turnCounter,
      childCounter: this.childCounter,
      ledger: this.ledger.exportSnapshot(),
      compression: this.compressionManager.exportSnapshot(),
      commitLog: this.commitLog.map((step) => ({ ...step })),
      children,
      sleepDeadlineMs: this.sleepDeadlineMs
    };
  }
  restoreFromSnapshot(snapshot, options) {
    const coldStart = options?.coldStart ?? false;
    const normalizedState = coldStart ? this.normalizeStateForColdStart(snapshot.state) : snapshot.state;
    const compressionSnapshot = coldStart && snapshot.compression.activeTask ? { ...snapshot.compression, activeTask: null } : snapshot.compression;
    const recoveryMessages = [];
    if (coldStart && normalizedState !== snapshot.state) {
      recoveryMessages.push(`This unit was restored after an interrupted session. Its previous active state was reset so it can resume from a clean starting point.`);
    }
    if (coldStart && snapshot.compression.activeTask) {
      recoveryMessages.push(`A context compression task (${snapshot.compression.activeTask.id}) was still active when the session was interrupted. It was cleared during recovery rather than resumed mid-flight.`);
    }
    this.suppressDurableStateChangeNotifications = true;
    try {
      this.unitId = snapshot.unitId;
      this.level = snapshot.level;
      this.workspaceRoot = snapshot.workspaceRoot;
      this.projectRoot = snapshot.projectRoot;
      this.scope = {
        level: snapshot.level,
        path: [...snapshot.path]
      };
      this.state = normalizedState;
      this.turnCounter = snapshot.turnCounter;
      this.childCounter = snapshot.childCounter;
      this.executingFromState = null;
      this.loopRunning = false;
      this.consecutiveEmptyTurns = 0;
      this.ledger.loadSnapshot(snapshot.ledger);
      if (coldStart) {
        const supersededCount = this.ledger.supersedeAllPendingProposals();
        if (supersededCount > 0) {
          recoveryMessages.push(`${supersededCount} pending proposal(s) were superseded during cold-start recovery. They can no longer be voted on; new proposals may be submitted instead.`);
        }
      }
      this.compressionManager.loadSnapshot(compressionSnapshot);
      this.commitLog = snapshot.commitLog.map((step) => ({ ...step }));
      this.children = /* @__PURE__ */ new Map();
      this.clearSleepState();
      for (const childEntry of snapshot.children) {
        const child = this.createChildUnit(
          childEntry.childId,
          childEntry.snapshot.level,
          childEntry.snapshot.path,
          childEntry.snapshot.unitId
        );
        child.restoreFromSnapshot(childEntry.snapshot, options);
        this.children.set(childEntry.childId, child);
      }
      if (snapshot.sleepDeadlineMs !== null) {
        const remainingMs = snapshot.sleepDeadlineMs - Date.now();
        if (remainingMs > 0) {
          this.scheduleSleepTimer(remainingMs, snapshot.sleepDeadlineMs);
        } else if (coldStart) {
          recoveryMessages.push(`A sleep timeout elapsed while the session was offline. The unit is now eligible to resume deliberation.`);
        }
      }
      if (coldStart) {
        const recoveryMeta = this.buildDeferredVisibilityMeta();
        for (const message of recoveryMessages) {
          this.ledger.appendSystemMessage(message, recoveryMeta);
        }
      }
    } finally {
      this.suppressDurableStateChangeNotifications = false;
      this.ledger.flushPendingUpdates();
    }
    this.notifyDurableStateChange();
  }
  terminate() {
    if (this.state !== "terminated") {
      for (const child of this.children.values()) {
        child.terminate();
      }
      this.transition(this.state, "terminated");
    }
  }
  buildChildCommitViews(limit = DeliberationUnit.CHILD_COMMIT_VIEW_LIMIT) {
    return [...this.children.keys()].map((childId) => {
      const child = this.children.get(childId);
      if (!child) {
        return null;
      }
      return {
        childId,
        state: child.getState(),
        committedSteps: child.getCommittedSteps(limit)
      };
    }).filter((view) => view !== null);
  }
  hasChildren() {
    return this.children.size > 0;
  }
  recordCommittedStep(proposal) {
    this.commitLog.push({
      toolName: proposal.toolName,
      proposedStep: proposal.proposedStep,
      proposedBy: proposal.proposer,
      committedAt: Date.now()
    });
  }
  buildDeferredVisibilityMeta() {
    return {
      turnAuthored: this.turnCounter,
      visibleFromTurn: this.turnCounter + 1
    };
  }
  getPendingProposal() {
    return this.ledger.getPendingProposalView();
  }
  static buildUnitId(level, path) {
    if (path.length === 0) return "unit-root";
    const padded = path.map((s) => String(s).padStart(2, "0"));
    return `${level}-${padded.join("-")}`;
  }
  static findNextChildSlot(parentLevel, parentPath, existingChildIds) {
    const childLevel = parentLevel === "L0" ? "L1" : "L2";
    for (let i = 1; i <= DeliberationUnit.MAX_CHILDREN; i++) {
      const childPath = [...parentPath, i];
      const padded = childPath.map((s) => String(s).padStart(2, "0"));
      const candidateId = `${childLevel}-${padded.join("-")}`;
      if (!existingChildIds.has(candidateId)) {
        return childPath;
      }
    }
    throw new Error("Could not find available child slot");
  }
  normalizeStateForColdStart(state) {
    if (state === "turn-a" || state === "turn-b" || state === "executing") {
      return "idle";
    }
    return state;
  }
  notifyDurableStateChange() {
    if (this.suppressDurableStateChangeNotifications) {
      return;
    }
    this.onDurableStateChange();
  }
  clearSleepState() {
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
    this.sleepDeadlineMs = null;
  }
  scheduleSleepTimer(timeoutMs, deadlineMs) {
    this.clearSleepState();
    this.sleepDeadlineMs = deadlineMs;
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = null;
      this.sleepDeadlineMs = null;
      this.ledger.appendSystemMessage(`The sleep timeout elapsed without any child unit reporting. The unit became eligible to resume deliberation.`, this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
      this.wakeIfIdle();
    }, timeoutMs);
    this.notifyDurableStateChange();
  }
  createChildUnit(childId, childLevel, childPath, unitId) {
    const child = new DeliberationUnit({
      llmClient: this.llmClient,
      toolExecutor: this.toolExecutor,
      workspaceRoot: this.workspaceRoot,
      projectRoot: this.projectRoot,
      level: childLevel,
      path: childPath,
      unitId,
      messagePersistenceSink: this.messagePersistenceSink,
      contextPersistenceSink: this.contextPersistenceSink,
      onSystemEvent: (event) => {
        if (event.type === "upward-message" && this.sameScope(event.scope, child.scope)) {
          const broadcastMeta = this.buildDeferredVisibilityMeta();
          this.ledger.appendChildReportMessage({
            childId,
            deliveryMode: event.deliveryMode,
            content: event.content,
            ...broadcastMeta
          });
          this.notifyDurableStateChange();
          this.wakeIfIdle();
        }
        this.emit(event);
      },
      onDurableStateChange: () => {
        this.notifyDurableStateChange();
      }
    });
    return child;
  }
  sameScope(left, right) {
    return left.level === right.level && left.path.length === right.path.length && left.path.every((segment, index) => segment === right.path[index]);
  }
  buildImmediateVisibilityMeta() {
    return {
      turnAuthored: this.turnCounter,
      visibleFromTurn: this.turnCounter
    };
  }
  appendChildCommitViewSnapshot(agentId, childCommitViews) {
    if (childCommitViews.length === 0) {
      return;
    }
    const rendered = this.projector.buildChildCommitViewMessage(agentId, childCommitViews);
    if (rendered && rendered.role === "user") {
      this.ledger.appendChildCommitViewMessage(rendered.content, this.buildImmediateVisibilityMeta());
      this.notifyDurableStateChange();
    }
  }
  persistContextTextRefs() {
    const memorySnapshot = this.compressionManager.getMemorySnapshot();
    const workspaceKnowledge = readRootAgentMd(this.workspaceRoot);
    if (!this.contextPersistenceSink) {
      return {
        memorySnapshotRowid: null,
        agentMdRowid: null,
        workspaceKnowledge
      };
    }
    let memorySnapshotRowid = null;
    if (memorySnapshot) {
      const metadata = JSON.stringify({
        sourceMessageCount: memorySnapshot.sourceMessageCount,
        requirements: memorySnapshot.requirements
      });
      memorySnapshotRowid = this.contextPersistenceSink.saveContextTextHistory(
        this.unitId,
        "memory_snapshot",
        memorySnapshot.content,
        metadata
      );
    }
    const agentMdRowid = workspaceKnowledge !== null ? this.contextPersistenceSink.saveContextTextHistory(
      this.unitId,
      "agent_md",
      workspaceKnowledge,
      JSON.stringify({ path: `${this.workspaceRoot}/AGENT.md` })
    ) : null;
    return {
      memorySnapshotRowid,
      agentMdRowid,
      workspaceKnowledge
    };
  }
  createContextRecipeFromPlan(plan) {
    if (!this.contextPersistenceSink) return;
    const recipe = {
      unitId: this.unitId,
      agentId: plan.agentId,
      recentRawStartSeq: plan.recentRawStartSeq,
      visibleEndSeq: plan.visibleEndSeq,
      newlyVisibleSeq: plan.newlyVisibleSeq,
      memorySnapshotRowid: plan.memorySnapshotRowid,
      agentMdRowid: plan.agentMdRowid,
      level: plan.level,
      hasPendingFromOther: plan.hasPendingFromOther,
      hasChildren: plan.hasChildren,
      canSpawnChild: plan.canSpawnChild,
      compressionReminderShown: plan.compressionReminderShown,
      compressionReminderChars: plan.compressionReminderChars,
      compressionReminderThresholdChars: plan.compressionReminderThresholdChars,
      truncationApplied: plan.truncationApplied,
      truncationReason: plan.truncationReason,
      truncationLevel: plan.truncationLevel,
      effectiveTurn: plan.effectiveTurn
    };
    this.activeRecipeId = this.contextPersistenceSink.createRecipe(recipe);
  }
  buildCompressionTaskStartMessage(task) {
    const requirementsPreview = task.requirements.length > 160 ? `${task.requirements.slice(0, 160)}...` : task.requirements;
    return `A background context compression task (${task.id}) started to refresh the unit's memory snapshot. The unit continues normal deliberation while this task runs, and no sleep is required merely to wait for compression completion. Preservation priorities: ${requirementsPreview || "none specified"}`;
  }
  buildCompressionTaskFailureMessage(task, error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `The context compression task (${task.id}) failed: ${detail}. The unit returned to a state with no active compression task so the agents can handle the failure and, if appropriate, propose another compression task.`;
  }
  buildCompressionTaskSuccessMessage(task) {
    return `The background context compression task (${task.id}) completed and refreshed the unit's memory snapshot. Future turns can use the updated snapshot without pausing the unit's workflow.`;
  }
  buildCompressionRequestMessage(task) {
    const existingSnapshot = task.existingMemorySnapshot?.content.trim() || "No prior Memory Snapshot is available.";
    const renderedHistory = this.projector.projectVisibleMessages(task.sourceMessages).map((message) => message.content).join("\n\n");
    return {
      role: "user",
      content: `[Compression Task]
Preservation requirements:
---
${task.requirements || "No extra preservation requirements were provided."}
---

Earlier Memory Snapshot reference:
---
${existingSnapshot}
---

Recent Raw Window:

${renderedHistory || "No recent raw conversation history is available."}

Write a refreshed Memory Snapshot that integrates the earlier snapshot reference with the recent raw window. Overlap between them is expected rather than erroneous.`,
      timestamp: Date.now()
    };
  }
  linkRecipeOutputMessage(outputMessageId) {
    if (this.activeRecipeId !== null && this.contextPersistenceSink) {
      this.contextPersistenceSink.updateRecipeOutputMessageId(this.activeRecipeId, outputMessageId);
      this.activeRecipeId = null;
    }
  }
  emitUpwardMessage(deliveryMode, content) {
    this.ledger.appendUpwardMessage({
      deliveryMode,
      content,
      ...this.buildDeferredVisibilityMeta()
    });
    this.notifyDurableStateChange();
    this.emit({ type: "upward-message", scope: this.scope, deliveryMode, content });
  }
  async executeCompressionTask(task) {
    try {
      const response = await this.llmClient.complete({
        systemPrompt: buildCompressionSystemPrompt(),
        messages: [this.buildCompressionRequestMessage(task)],
        tools: []
      }, { maxTokens: DeliberationUnit.COMPRESSION_MAX_TOKENS });
      const content = response.content.filter((block) => block.type === "text").map((block) => block.text).join("").trim();
      if (!content) {
        throw new Error("The compression LLM returned an empty memory snapshot.");
      }
      this.compressionManager.registerSuccess(content, this.ledger.readAll());
      this.ledger.appendSystemMessage(this.buildCompressionTaskSuccessMessage(task), this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
    } catch (error) {
      const failure = this.compressionManager.registerFailure();
      this.notifyDurableStateChange();
      if (failure.shouldRetry) {
        this.emit({
          type: "warning",
          scope: this.scope,
          message: `Context compression task ${failure.task.id} failed on attempt ${failure.task.attemptNumber - 1}. Retrying automatically once more.`
        });
        void this.executeCompressionTask(failure.task);
        return;
      }
      const failureMessage = this.buildCompressionTaskFailureMessage(task, error);
      this.ledger.appendSystemMessage(failureMessage, this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
      this.emit({ type: "warning", scope: this.scope, message: failureMessage });
      this.wakeIfIdle();
    }
  }
  static isContextTooLongError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes("max message tokens") || msg.includes("context_length_exceeded") || msg.includes("context window") || msg.includes("maximum context") || msg.includes("tokens exceed") || msg.includes("token limit") || msg.includes("400") && msg.includes("tokens");
  }
  async runLoop() {
    while (this.state === "turn-a" || this.state === "turn-b") {
      const currentAgent = this.state === "turn-a" ? "agent-a" : "agent-b";
      const agentName = AGENT_NAMES[currentAgent];
      const agentTurn = currentAgent === "agent-a" ? this.agentA : this.agentB;
      this.turnCounter++;
      this.notifyDurableStateChange();
      const hasChildren = this.hasChildren();
      const childCommitViews = hasChildren ? this.buildChildCommitViews() : [];
      this.appendChildCommitViewSnapshot(currentAgent, childCommitViews);
      const visibleSnapshot = this.ledger.readVisibleSnapshotForAgent(currentAgent, this.turnCounter);
      const canSpawnChild = this.children.size < DeliberationUnit.MAX_CHILDREN;
      const pendingProposal = this.getPendingProposal();
      const persistedContextTextRefs = this.persistContextTextRefs();
      const reminderShown = this.compressionManager.shouldShowReminder(visibleSnapshot.visibleMessages);
      const reminderChars = reminderShown ? this.compressionManager.estimateRecentRawChars(visibleSnapshot.visibleMessages) : null;
      const reminderThresholdChars = reminderShown ? this.compressionManager.getReminderThresholdChars() : null;
      let budgetPlan = createTurnContextBudgetPlan({
        visibleMessages: visibleSnapshot.visibleMessages,
        newlyVisibleMessages: visibleSnapshot.newlyVisibleMessages,
        currentSequenceStart: this.ledger.currentSequenceStart,
        baseRecentRawStartSeq: this.ledger.currentSequenceStart + this.compressionManager.getRecentRawStartIndex(),
        compressionReminderShown: reminderShown,
        compressionReminderChars: reminderChars,
        compressionReminderThresholdChars: reminderThresholdChars,
        capacityGuardCharLimit: this.compressionManager.getCapacityGuardCharLimit()
      });
      const assembleCurrentTurn = (plan) => assembleTurnContext({
        unitId: this.unitId,
        agentId: currentAgent,
        level: this.level,
        workspaceRoot: this.workspaceRoot,
        workspaceKnowledge: persistedContextTextRefs.workspaceKnowledge,
        agentMdRowid: persistedContextTextRefs.agentMdRowid,
        visibleMessages: visibleSnapshot.visibleMessages,
        newlyVisibleMessages: visibleSnapshot.newlyVisibleMessages,
        pendingProposal,
        hasChildren,
        canSpawnChild,
        memorySnapshot: this.compressionManager.getMemorySnapshot(),
        memorySnapshotRowid: persistedContextTextRefs.memorySnapshotRowid,
        budgetPlan: plan,
        contextWindowTokens: this.compressionManager.getModelInfo()?.contextWindowTokens,
        effectiveTurn: this.turnCounter
      });
      let assembled = assembleCurrentTurn(budgetPlan);
      this.emit({
        type: "turn-start",
        scope: this.scope,
        turn: this.turnCounter,
        agent: currentAgent,
        state: this.state,
        contextSize: assembled.llmContext.messages.length,
        newMessages: visibleSnapshot.newlyVisibleMessages.length
      });
      let result;
      while (true) {
        this.createContextRecipeFromPlan(assembled.plan);
        if (assembled.plan.truncationApplied) {
          this.emit({
            type: "warning",
            scope: this.scope,
            message: `Context capacity guard triggered truncation before calling ${agentName} (level: ${assembled.plan.truncationLevel}). Estimated context is near model limits.`
          });
        }
        console.log(`[DU:${this.unitId}] turn#${this.turnCounter} ${agentName}: calling LLM with ${assembled.llmContext.messages.length} messages, recentRawStartSeq=${assembled.plan.recentRawStartSeq}, visibleEndSeq=${assembled.plan.visibleEndSeq}, truncationLevel=${assembled.plan.truncationLevel}`);
        try {
          const llmSignal = AbortSignal.timeout(this.llmTimeoutMs);
          result = await agentTurn.execute(assembled.llmContext, assembled.tools, llmSignal);
          break;
        } catch (err) {
          if (err instanceof DOMException && err.name === "TimeoutError") {
            this.handleTimeout("llm", this.llmTimeoutMs);
            return;
          }
          console.error(`[DU:${this.unitId}] LLM call failed (truncation level ${assembled.plan.truncationLevel}):`, err);
          if (!DeliberationUnit.isContextTooLongError(err)) {
            this.emit({ type: "error", scope: this.scope, message: `LLM call failed for ${agentName}: ${err}. Check API key, base URL, and network connectivity.` });
            this.transition(this.state, "idle");
            return;
          }
          const tightenedPlan = tightenTurnContextBudgetPlan({
            visibleMessages: visibleSnapshot.visibleMessages,
            currentSequenceStart: this.ledger.currentSequenceStart,
            currentPlan: budgetPlan,
            targetRecentRawChars: Math.max(Math.floor(this.compressionManager.getRecentRawTargetChars() / 2), 1200)
          });
          if (!tightenedPlan) {
            this.emit({ type: "error", scope: this.scope, message: `Context too long for ${agentName} even after deterministic recent-raw truncation. Please compress the context manually using compressContext.` });
            this.transition(this.state, "idle");
            return;
          }
          budgetPlan = tightenedPlan;
          assembled = assembleCurrentTurn(budgetPlan);
          this.emit({
            type: "warning",
            scope: this.scope,
            message: `Context too long — rebuilding ${agentName}'s turn with a tighter recent-raw window (truncation level ${assembled.plan.truncationLevel}).`
          });
        }
      }
      console.log(`[DU:${this.unitId}] turn#${this.turnCounter} ${agentName}: reply=${JSON.stringify(result.reply?.slice(0, 100))}, action=${result.action?.kind ?? "none"}, stopReason=${result.stopReason}, broadcasts=${result.unitRuntimeBroadcasts?.length ?? 0}`);
      const isEmpty = !result.reply?.trim() && !result.action && !result.unitRuntimeBroadcasts?.length;
      if (isEmpty) {
        this.consecutiveEmptyTurns++;
        console.warn(`[DU:${this.unitId}] turn#${this.turnCounter} ${agentName}: EMPTY response (consecutive=${this.consecutiveEmptyTurns}/${DeliberationUnit.MAX_EMPTY_TURNS})`);
        if (this.consecutiveEmptyTurns >= DeliberationUnit.MAX_EMPTY_TURNS) {
          this.emit({ type: "error", scope: this.scope, message: `${DeliberationUnit.MAX_EMPTY_TURNS} consecutive empty responses detected. Halting — likely API misconfiguration (wrong key, URL, or model).` });
          this.transition(this.state, "idle");
          return;
        }
      } else {
        this.consecutiveEmptyTurns = 0;
      }
      if (result.reply) {
        const agentMsg = this.ledger.appendAgentMessage(currentAgent, result.reply, this.buildDeferredVisibilityMeta());
        this.linkRecipeOutputMessage(agentMsg.id);
        this.notifyDurableStateChange();
        this.emit({ type: "agent-message", scope: this.scope, turn: this.turnCounter, agent: currentAgent, content: result.reply });
      }
      if (result.unitRuntimeBroadcasts?.length) {
        const broadcastMeta = this.buildDeferredVisibilityMeta();
        for (const broadcast of result.unitRuntimeBroadcasts) {
          this.ledger.appendSystemMessage(broadcast.content, broadcastMeta);
          this.emit({ type: "warning", scope: this.scope, message: broadcast.content });
        }
        this.notifyDurableStateChange();
      }
      if (result.stopReason === "length") {
        this.emit({ type: "warning", scope: this.scope, message: `${agentName}'s response was truncated (stopReason: length). Consider increasing maxTokens.` });
      }
      if (result.action?.kind === "vote" && pendingProposal) {
        const vote = result.action.vote;
        const toolName = pendingProposal.toolName;
        const voteMeta = this.buildDeferredVisibilityMeta();
        if (vote.approve) {
          const approvedProposal = pendingProposal;
          this.emit({ type: "vote", scope: this.scope, voter: currentAgent, proposer: pendingProposal.proposer, toolName, approve: true, reason: vote.reason });
          const voteMessage = this.ledger.appendVoteMessage({
            voter: currentAgent,
            proposalId: approvedProposal.messageId,
            approve: true,
            reason: vote.reason,
            ...voteMeta
          });
          this.linkRecipeOutputMessage(voteMessage.id);
          this.ledger.markProposalApproved(approvedProposal.messageId);
          this.recordCommittedStep(approvedProposal);
          this.notifyDurableStateChange();
          const resolvedTool = getBuiltInToolRegistry(this.level).get(toolName);
          if (toolName === "yield") {
            const yieldContent = approvedProposal.args.content;
            this.emitUpwardMessage("yield", yieldContent);
            this.transition(this.state, "idle");
            return;
          }
          if (toolName === "sleep") {
            const timeoutMs = approvedProposal.args.timeoutSeconds * 1e3;
            this.transition(this.state, "idle");
            this.scheduleSleepTimer(timeoutMs, Date.now() + timeoutMs);
            return;
          }
          if (resolvedTool?.behavior === "blocking") {
            this.executingFromState = this.state;
            this.transition(this.state, "executing");
            this.emit({ type: "tool-executing", scope: this.scope, toolName: approvedProposal.toolName, args: approvedProposal.args });
            let execResult;
            try {
              const toolSignal = AbortSignal.timeout(this.toolTimeoutMs);
              execResult = await this.toolExecutor.execute(approvedProposal.toolName, approvedProposal.args, { cwd: this.projectRoot, level: this.level, signal: toolSignal });
            } catch (err) {
              if (err instanceof DOMException && err.name === "TimeoutError") {
                this.handleTimeout("tool", this.toolTimeoutMs);
                return;
              }
              throw err;
            }
            this.ledger.appendToolResultMessage({
              proposalId: approvedProposal.messageId,
              toolName,
              success: execResult.success,
              output: execResult.output,
              durationMs: execResult.durationMs,
              ...this.buildDeferredVisibilityMeta()
            });
            this.notifyDurableStateChange();
            this.emit({ type: "tool-result", scope: this.scope, toolName, success: execResult.success, output: execResult.output, durationMs: execResult.durationMs });
            const nextState2 = this.executingFromState === "turn-a" ? "turn-b" : "turn-a";
            this.executingFromState = null;
            this.transition("executing", nextState2);
            continue;
          }
          if (resolvedTool?.behavior === "nonblocking") {
            this.executeNonBlockingTool(approvedProposal);
          }
        } else {
          this.emit({ type: "vote", scope: this.scope, voter: currentAgent, proposer: pendingProposal.proposer, toolName, approve: false, reason: vote.reason });
          const voteMessage = this.ledger.appendVoteMessage({
            voter: currentAgent,
            proposalId: pendingProposal.messageId,
            approve: false,
            reason: vote.reason,
            ...voteMeta
          });
          this.linkRecipeOutputMessage(voteMessage.id);
          this.ledger.markProposalRejected(pendingProposal.messageId);
          this.notifyDurableStateChange();
        }
      }
      if (result.action?.kind === "proposal") {
        const proposal = result.action.proposal;
        const proposalMessage = this.ledger.appendProposalMessage({
          authoredBy: currentAgent,
          toolName: proposal.toolName,
          args: proposal.args,
          proposedStep: proposal.proposedStep,
          ...this.buildDeferredVisibilityMeta()
        });
        this.linkRecipeOutputMessage(proposalMessage.id);
        this.notifyDurableStateChange();
        this.emit({ type: "proposal", scope: this.scope, agent: currentAgent, toolName: proposal.toolName, args: proposal.args });
        const resolvedTool = getBuiltInToolRegistry(this.level).get(proposal.toolName);
        if (resolvedTool?.autoApprove) {
          const autoApprovedProposal = this.getPendingProposal();
          if (autoApprovedProposal) {
            this.ledger.markProposalApproved(autoApprovedProposal.messageId);
            this.recordCommittedStep(autoApprovedProposal);
            this.ledger.appendSystemMessage(
              `${proposal.toolName} executed (read-only operations do not require partner vote)`,
              this.buildDeferredVisibilityMeta()
            );
            this.notifyDurableStateChange();
            this.executingFromState = this.state;
            this.transition(this.state, "executing");
            this.emit({ type: "tool-executing", scope: this.scope, toolName: autoApprovedProposal.toolName, args: autoApprovedProposal.args });
            let execResult;
            try {
              const toolSignal = AbortSignal.timeout(this.toolTimeoutMs);
              execResult = await this.toolExecutor.execute(autoApprovedProposal.toolName, autoApprovedProposal.args, { cwd: this.projectRoot, level: this.level, signal: toolSignal });
            } catch (err) {
              if (err instanceof DOMException && err.name === "TimeoutError") {
                this.handleTimeout("tool", this.toolTimeoutMs);
                return;
              }
              throw err;
            }
            this.ledger.appendToolResultMessage({
              proposalId: autoApprovedProposal.messageId,
              toolName: proposal.toolName,
              success: execResult.success,
              output: execResult.output,
              durationMs: execResult.durationMs,
              ...this.buildDeferredVisibilityMeta()
            });
            this.notifyDurableStateChange();
            this.emit({ type: "tool-result", scope: this.scope, toolName: proposal.toolName, success: execResult.success, output: execResult.output, durationMs: execResult.durationMs });
            const autoNextState = this.executingFromState === "turn-a" ? "turn-b" : "turn-a";
            this.executingFromState = null;
            this.transition("executing", autoNextState);
            continue;
          }
        }
      }
      const nextState = this.state === "turn-a" ? "turn-b" : "turn-a";
      this.transition(this.state, nextState);
    }
  }
  executeNonBlockingTool(proposal) {
    const { toolName, args } = proposal;
    if (toolName === "report") {
      const content = String(args.content ?? "");
      this.emitUpwardMessage("report", content);
      return;
    }
    if (toolName === "compressContext") {
      const requirements = String(args.requirements ?? "");
      const allMessages = this.ledger.readAll();
      const recentRawMessages = this.compressionManager.getRecentRawMessages(allMessages);
      const started = this.compressionManager.startTask(
        requirements,
        recentRawMessages,
        this.compressionManager.getMemorySnapshot()
      );
      if (!started.ok) {
        this.ledger.appendSystemMessage(started.error, this.buildDeferredVisibilityMeta());
        this.notifyDurableStateChange();
        this.emit({ type: "warning", scope: this.scope, message: started.error });
        return;
      }
      this.ledger.appendSystemMessage(this.buildCompressionTaskStartMessage(started.task), this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
      void this.executeCompressionTask(started.task);
      return;
    }
    if (toolName === "spawnChild") {
      if (this.children.size >= DeliberationUnit.MAX_CHILDREN) {
        this.ledger.appendSystemMessage(
          `Cannot spawn child: maximum child count (${DeliberationUnit.MAX_CHILDREN}) reached. Use sendToChild to send additional context to the most relevant existing child instead.`,
          this.buildDeferredVisibilityMeta()
        );
        this.notifyDurableStateChange();
        this.emit({ type: "warning", scope: this.scope, message: `spawnChild rejected: child limit (${DeliberationUnit.MAX_CHILDREN}) reached` });
        return;
      }
      const task = args.task;
      const childLevel = this.level === "L0" ? "L1" : "L2";
      const existingChildIds = new Set(this.children.keys());
      const childPath = DeliberationUnit.findNextChildSlot(this.level, this.scope.path, existingChildIds);
      const childId = DeliberationUnit.buildUnitId(childLevel, childPath);
      this.childCounter = childPath[childPath.length - 1];
      const child = this.createChildUnit(childId, childLevel, childPath);
      this.children.set(childId, child);
      const taskPreview = task.length > 100 ? task.slice(0, 100) + "..." : task;
      this.ledger.appendSystemMessage(`Child unit ${childId} started with the following task: ${taskPreview}`, this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
      this.emit({ type: "child-spawned", scope: child.scope, task });
      child.injectUserMessage(task);
    } else if (toolName === "sendToChild") {
      const childId = args.childId;
      const message = args.message;
      const child = this.children.get(childId);
      if (!child) {
        const childIds = [...this.children.keys()].join(", ") || "none";
        this.ledger.appendSystemMessage(`The message could not be delivered to child unit ${childId} because no such child unit exists. Current child units: ${childIds}`, this.buildDeferredVisibilityMeta());
        this.notifyDurableStateChange();
        this.emit({ type: "warning", scope: this.scope, message: `sendToChild failed: child ${childId} not found` });
        return;
      }
      if (child.getState() !== "idle") {
        this.ledger.appendSystemMessage(`Child unit ${childId} is currently active — the message was queued and will be available to that child as it continues work.`, this.buildDeferredVisibilityMeta());
        this.notifyDurableStateChange();
      }
      child.injectUserMessage(message);
      this.ledger.appendSystemMessage(`The following message was sent to child unit ${childId}: ${message.length > 100 ? message.slice(0, 100) + "..." : message}`, this.buildDeferredVisibilityMeta());
      this.notifyDurableStateChange();
      this.emit({ type: "child-message-sent", scope: child.scope, message });
    }
  }
  handleTimeout(source, timeoutMs) {
    const label = source === "llm" ? "LLM call" : "blocking tool execution";
    const message = `Turn timed out after ${Math.round(timeoutMs / 1e3)}s waiting for ${label}. Unit is yielding to parent.`;
    console.warn(`[DU:${this.unitId}] T10 timeout guard: ${message}`);
    this.ledger.appendSystemMessage(message, this.buildDeferredVisibilityMeta());
    this.notifyDurableStateChange();
    this.emitUpwardMessage("yield", message);
    this.executingFromState = null;
    this.transition(this.state, "idle");
  }
  emit(event) {
    this.onSystemEvent(event);
  }
  wakeIfIdle() {
    this.clearSleepState();
    if (this.state === "idle" && !this.loopRunning) {
      this.transition("idle", "turn-a");
      this.loopRunning = true;
      this.runLoop().catch((err) => {
        this.emit({ type: "error", scope: this.scope, message: `Deliberation loop crashed: ${err}` });
      }).finally(() => {
        this.loopRunning = false;
      });
    }
  }
  transition(from, to) {
    this.emit({ type: "state-transition", scope: this.scope, from, to });
    this.state = to;
    this.notifyDurableStateChange();
  }
}
class DeliberationSession {
  unit;
  persistence;
  constructor(options) {
    this.persistence = options.persistence ?? null;
    initializeKnowledgeView(options.workspaceRoot);
    const restoredSnapshot = this.persistence?.loadSnapshot() ?? null;
    this.unit = new DeliberationUnit({
      llmClient: options.llmClient,
      toolExecutor: options.toolExecutor,
      workspaceRoot: options.workspaceRoot,
      projectRoot: options.projectRoot,
      level: restoredSnapshot?.level ?? options.level,
      path: restoredSnapshot?.path,
      unitId: restoredSnapshot?.unitId,
      onSystemEvent: options.onSystemEvent,
      onDurableStateChange: () => {
        this.persist();
      },
      messagePersistenceSink: this.persistence ? {
        onMessageCreated: (message, seq) => {
          this.persistence.appendMessage(this.unit.getUnitId(), seq, message);
        },
        onMessageUpdated: (message) => {
          this.persistence.updateMessage(this.unit.getUnitId(), message);
        }
      } : void 0,
      contextPersistenceSink: this.persistence ?? void 0
    });
    if (restoredSnapshot) {
      this.unit.restoreFromSnapshot(restoredSnapshot, {
        coldStart: true
      });
    }
    this.persist();
  }
  close() {
    this.unit.close();
    this.persist();
    this.persistence?.close?.();
  }
  sendUserMessage(content) {
    this.unit.injectUserMessage(content);
  }
  terminate() {
    this.unit.terminate();
    this.persist();
  }
  getState() {
    return this.unit.getState();
  }
  getCommittedSteps(limit) {
    return this.unit.getCommittedSteps(limit);
  }
  getUnitId() {
    return this.unit.getUnitId();
  }
  exportSnapshot() {
    return this.unit.exportSnapshot();
  }
  getRootUnit() {
    return this.unit;
  }
  persist() {
    if (!this.persistence) {
      return;
    }
    this.persistence.saveSnapshot(this.unit.exportSnapshot());
  }
}
function createSession(options) {
  return new DeliberationSession(options);
}
class PiAiLlmClient {
  constructor(model) {
    this.model = model;
  }
  model;
  getModelInfo() {
    return {
      contextWindowTokens: this.model.contextWindow,
      maxOutputTokens: this.model.maxTokens
    };
  }
  async complete(context, options) {
    const response = await complete(this.model, {
      systemPrompt: context.systemPrompt,
      messages: context.messages,
      tools: context.tools
    }, { maxTokens: options.maxTokens, signal: options.signal });
    const result = response;
    if (response.errorMessage) {
      result.errorMessage = response.errorMessage;
    }
    return result;
  }
}
function createPiAiLlmClient(config) {
  const model = getModel(config.provider, config.modelName);
  if (!model) {
    return null;
  }
  if (config.baseUrl) {
    model.baseUrl = config.baseUrl;
  }
  return new PiAiLlmClient(model);
}
const piAiClient = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  PiAiLlmClient,
  createPiAiLlmClient
}, Symbol.toStringTag, { value: "Module" }));
const BASH_TIMEOUT_MS = 3e4;
const MAX_OUTPUT_CHARS = 5e4;
const L0_ALLOWED_COMMANDS = /* @__PURE__ */ new Set([
  "ls",
  "find",
  "tree",
  "cat",
  "head",
  "tail",
  "grep",
  "wc",
  "du",
  "file",
  "stat",
  "pwd",
  "which",
  "echo",
  "diff",
  "sort",
  "uniq",
  "type",
  "less",
  "more",
  "printenv",
  "env",
  "date",
  "uname",
  "hostname",
  "whoami",
  "id",
  "git"
]);
const L0_REJECTION_MESSAGE = "L0 hard constraint: this command is not in the information-gathering whitelist. As the top-level coordinator, delegate task execution to a child unit using spawnChild. Your bash access is for surveying and inspecting — not for doing the work yourself.";
function extractFirstCommand(input) {
  const trimmed = input.trimStart();
  const match = trimmed.match(/^([^\s|;&><]+)/);
  return match ? match[1] : "";
}
function isL0BashAllowed(command) {
  const first = extractFirstCommand(command);
  const basename = first.includes("/") ? first.split("/").pop() : first;
  return L0_ALLOWED_COMMANDS.has(basename);
}
function truncateOutput(output) {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return output.slice(0, MAX_OUTPUT_CHARS) + `

[Output truncated: ${output.length} chars total, showing first ${MAX_OUTPUT_CHARS}]`;
}
async function executeBash(command, cwd) {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: BASH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (error && !combined) {
        resolve({
          success: false,
          output: `Command failed: ${error.message}`
        });
      } else {
        resolve({
          success: !error,
          output: truncateOutput(combined || "(no output)")
        });
      }
    });
  });
}
async function executeReadFile(path, offset, limit) {
  try {
    const content = await readFile(path, "utf-8");
    const allLines = content.split("\n");
    if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
      allLines.pop();
    }
    const totalLines = allLines.length;
    const startLine = Math.max(1, Math.floor(offset ?? 1));
    const maxLines = limit !== void 0 ? Math.max(1, Math.floor(limit)) : void 0;
    const startIdx = startLine - 1;
    const selectedLines = maxLines !== void 0 ? allLines.slice(startIdx, startIdx + maxLines) : allLines.slice(startIdx);
    if (selectedLines.length === 0) {
      return { success: true, output: `(empty range: file has ${totalLines} line${totalLines === 1 ? "" : "s"}, requested start at line ${startLine})` };
    }
    const endLine = startLine + selectedLines.length - 1;
    const width = String(endLine).length;
    const numbered = selectedLines.map((line, i) => {
      const lineNum = String(startLine + i).padStart(width, " ");
      return `${lineNum} | ${line}`;
    }).join("\n");
    const header = totalLines > selectedLines.length ? `(lines ${startLine}-${endLine} of ${totalLines})
` : "";
    return { success: true, output: truncateOutput(header + numbered) };
  } catch (err) {
    return { success: false, output: `Failed to read file: ${err.message}` };
  }
}
async function executeWriteFile(path, content) {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf-8");
    return { success: true, output: `File written successfully: ${path} (${content.length} chars)` };
  } catch (err) {
    return { success: false, output: `Failed to write file: ${err.message}` };
  }
}
class LocalNodeToolExecutor {
  async execute(toolName, args, options) {
    const start = Date.now();
    let result;
    switch (toolName) {
      case "bash":
        if (options?.level === "L0" && !isL0BashAllowed(args.command)) {
          result = { success: false, output: L0_REJECTION_MESSAGE };
        } else {
          result = await executeBash(args.command, options?.cwd);
        }
        break;
      case "readFile":
        result = await executeReadFile(
          args.path,
          args.offset,
          args.limit
        );
        break;
      case "writeFile":
        result = await executeWriteFile(args.path, args.content);
        break;
      default:
        result = { success: false, output: `Unknown blocking tool: ${toolName}` };
    }
    return { ...result, durationMs: Date.now() - start };
  }
}
const DEFAULT_SESSION_ID = "session-default";
const DEFAULT_REMINDER_THRESHOLD_CHARS = 12e4;
const DEFAULT_RECENT_RAW_TARGET_CHARS = 24e3;
const DEFAULT_MAX_RETRIES = 1;
const AGENT_IDS = ["agent-a", "agent-b"];
const CURRENT_SCHEMA_VERSION = "12";
function parseJson(value) {
  return JSON.parse(value);
}
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function hashPath(absolutePath) {
  let hash = 0;
  for (let i = 0; i < absolutePath.length; i++) {
    const char = absolutePath.charCodeAt(i);
    hash = (hash << 5) - hash + char | 0;
  }
  return Math.abs(hash).toString(36);
}
function toAgentCursorExclusive(sequenceStart, cursorIndex) {
  return sequenceStart - 1 + cursorIndex;
}
function buildMessageMetadata(message) {
  if (message.kind === "proposal_message") {
    return {
      agentId: message.authoredBy,
      proposalStatus: message.status,
      proposalRefMessageId: null,
      toolName: message.toolName,
      deliveryMode: null,
      success: null
    };
  }
  if (message.kind === "vote_message") {
    return {
      agentId: message.authoredBy,
      proposalStatus: null,
      proposalRefMessageId: message.proposalId,
      toolName: null,
      deliveryMode: null,
      success: null
    };
  }
  if (message.kind === "tool_result_message") {
    return {
      agentId: null,
      proposalStatus: null,
      proposalRefMessageId: message.proposalId,
      toolName: message.toolName,
      deliveryMode: null,
      success: message.success ? 1 : 0
    };
  }
  if (message.kind === "upward_message") {
    return {
      agentId: null,
      proposalStatus: null,
      proposalRefMessageId: null,
      toolName: null,
      deliveryMode: message.deliveryMode,
      success: null
    };
  }
  if (message.kind === "child_report_message") {
    return {
      agentId: null,
      proposalStatus: null,
      proposalRefMessageId: null,
      toolName: null,
      deliveryMode: message.deliveryMode,
      success: null
    };
  }
  return {
    agentId: message.authoredBy === "agent-a" || message.authoredBy === "agent-b" ? message.authoredBy : null,
    proposalStatus: null,
    proposalRefMessageId: null,
    toolName: null,
    deliveryMode: null,
    success: null
  };
}
class SqliteSessionPersistence {
  db;
  constructor(options) {
    hashPath(options.projectRoot);
    const storageDir = join(options.workspaceRoot, ".elenchus-state");
    mkdirSync(storageDir, { recursive: true });
    this.db = new Database(join(storageDir, "state.db"));
    this.db.pragma("foreign_keys = OFF");
    this.initializeSchema();
  }
  close() {
    this.db.close();
  }
  appendMessage(unitId, seq, message) {
    const metadata = buildMessageMetadata(message);
    this.db.prepare(`
      INSERT INTO ledger_messages (
        message_id, unit_id, seq, version, kind, turn_authored, visible_from_turn,
        created_at, agent_id, proposal_status, proposal_ref_message_id,
        tool_name, delivery_mode, success, body
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      unitId,
      seq,
      message.kind,
      message.turnAuthored,
      message.visibleFromTurn,
      message.timestamp,
      metadata.agentId,
      metadata.proposalStatus,
      metadata.proposalRefMessageId,
      metadata.toolName,
      metadata.deliveryMode,
      metadata.success,
      JSON.stringify(message)
    );
  }
  updateMessage(unitId, message) {
    const metadata = buildMessageMetadata(message);
    const currentVersion = this.db.prepare(`SELECT MAX(version) AS max_version FROM ledger_messages WHERE message_id = ?`).get(message.id)?.max_version ?? 0;
    const nextVersion = currentVersion + 1;
    const seq = this.db.prepare(`SELECT seq FROM ledger_messages WHERE message_id = ? AND version = ?`).get(message.id, currentVersion)?.seq;
    if (seq === void 0) {
      throw new Error(`Cannot update message ${message.id}: no previous version found in ledger_messages`);
    }
    this.db.prepare(`
      INSERT INTO ledger_messages (
        message_id, unit_id, seq, version, kind, turn_authored, visible_from_turn,
        created_at, agent_id, proposal_status, proposal_ref_message_id,
        tool_name, delivery_mode, success, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      unitId,
      seq,
      nextVersion,
      message.kind,
      message.turnAuthored,
      message.visibleFromTurn,
      message.timestamp,
      metadata.agentId,
      metadata.proposalStatus,
      metadata.proposalRefMessageId,
      metadata.toolName,
      metadata.deliveryMode,
      metadata.success,
      JSON.stringify(message)
    );
  }
  loadSnapshot() {
    const sessionRow = this.db.prepare(`SELECT session_id, root_unit_id FROM sessions WHERE session_id = ? LIMIT 1`).get(DEFAULT_SESSION_ID);
    if (!sessionRow) {
      return null;
    }
    this.db.prepare(`UPDATE sessions SET last_recovered_at = ?, updated_at = updated_at WHERE session_id = ?`).run(Date.now(), DEFAULT_SESSION_ID);
    return this.loadUnitSnapshot(sessionRow.root_unit_id);
  }
  saveSnapshot(snapshot) {
    const now = Date.now();
    const write = this.db.transaction((rootSnapshot) => {
      this.db.prepare(`
        INSERT INTO sessions (session_id, root_unit_id, status, created_at, updated_at, last_recovered_at)
        VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT(session_id) DO UPDATE SET
          root_unit_id = excluded.root_unit_id,
          status = excluded.status,
          updated_at = excluded.updated_at
      `).run(
        DEFAULT_SESSION_ID,
        rootSnapshot.unitId,
        rootSnapshot.state === "terminated" ? "terminated" : "active",
        now,
        now
      );
      this.saveUnitSnapshot(rootSnapshot, DEFAULT_SESSION_ID, now);
    });
    write(snapshot);
  }
  initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const currentSchemaVersion = this.db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get()?.value ?? null;
    if (currentSchemaVersion !== CURRENT_SCHEMA_VERSION) {
      this.rebuildSchema();
    }
    this.ensureSchema();
  }
  rebuildSchema() {
    this.db.exec(`
      DROP TABLE IF EXISTS context_recipe;
      DROP TABLE IF EXISTS context_text_history;
      DROP TABLE IF EXISTS unit_compression_state;
      DROP TABLE IF EXISTS unit_memory_state;
      DROP TABLE IF EXISTS committed_steps;
      DROP TABLE IF EXISTS ledger_messages;
      DROP TABLE IF EXISTS unit_agent_cursors;
      DROP TABLE IF EXISTS unit_children;
      DROP TABLE IF EXISTS units;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS schema_meta;
    `);
  }
  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        root_unit_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_recovered_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS units (
        unit_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        level TEXT NOT NULL,
        path TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        project_root TEXT NOT NULL,
        state TEXT NOT NULL,
        turn_counter INTEGER NOT NULL,
        child_counter INTEGER NOT NULL,
        sleep_deadline_ms INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        terminated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS unit_children (
        parent_unit_id TEXT NOT NULL,
        child_key TEXT NOT NULL,
        child_unit_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(parent_unit_id, child_key),
        UNIQUE(child_unit_id)
      );

      CREATE TABLE IF NOT EXISTS unit_agent_cursors (
        unit_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        cursor_exclusive INTEGER NOT NULL,
        PRIMARY KEY(unit_id, agent_id)
      );

      CREATE TABLE IF NOT EXISTS ledger_messages (
        message_id TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        kind TEXT NOT NULL,
        turn_authored INTEGER NOT NULL,
        visible_from_turn INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        agent_id TEXT,
        proposal_status TEXT,
        proposal_ref_message_id TEXT,
        tool_name TEXT,
        delivery_mode TEXT,
        success INTEGER,
        body TEXT NOT NULL,
        UNIQUE(message_id, version)
      );

      CREATE TABLE IF NOT EXISTS committed_steps (
        unit_id TEXT NOT NULL,
        step_seq INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        proposed_step TEXT NOT NULL,
        proposed_by TEXT NOT NULL,
        committed_at INTEGER NOT NULL,
        PRIMARY KEY(unit_id, step_seq)
      );

      CREATE TABLE IF NOT EXISTS context_text_history (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        unit_id TEXT NOT NULL,
        category TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        effective_turn INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_ctx_text_dedup
        ON context_text_history(unit_id, category, content_hash);

      CREATE INDEX IF NOT EXISTS idx_ctx_text_unit_category_id
        ON context_text_history(unit_id, category, rowid DESC);

      CREATE TABLE IF NOT EXISTS context_recipe (
        recipe_id INTEGER PRIMARY KEY AUTOINCREMENT,
        unit_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        recent_raw_start_seq INTEGER NOT NULL,
        visible_end_seq INTEGER NOT NULL,
        newly_visible_seq INTEGER,
        memory_snapshot_rowid INTEGER,
        agent_md_rowid INTEGER,
        level TEXT NOT NULL,
        has_pending_from_other INTEGER NOT NULL DEFAULT 0,
        has_children INTEGER NOT NULL DEFAULT 0,
        can_spawn_child INTEGER NOT NULL DEFAULT 0,
        compression_reminder_shown INTEGER NOT NULL DEFAULT 0,
        compression_reminder_chars INTEGER,
        compression_reminder_threshold_chars INTEGER,
        truncation_applied INTEGER NOT NULL DEFAULT 0,
        truncation_reason TEXT NOT NULL DEFAULT 'none',
        truncation_level INTEGER NOT NULL DEFAULT 0,
        output_message_id TEXT,
        effective_turn INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_recipe_output_message
        ON context_recipe(output_message_id)
        WHERE output_message_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS unit_compression_state (
        unit_id TEXT PRIMARY KEY,
        active_task_id TEXT,
        requirements TEXT,
        source_message_count INTEGER,
        attempt_number INTEGER,
        max_attempts INTEGER,
        started_at INTEGER,
        reminder_threshold_chars INTEGER NOT NULL,
        recent_raw_target_chars INTEGER NOT NULL,
        max_retries INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ledger_unit_seq
      ON ledger_messages(unit_id, seq);

      CREATE INDEX IF NOT EXISTS idx_ledger_unit_visible_turn
      ON ledger_messages(unit_id, visible_from_turn, seq);

      CREATE INDEX IF NOT EXISTS idx_ledger_unit_kind_seq
      ON ledger_messages(unit_id, kind, seq);

      CREATE INDEX IF NOT EXISTS idx_ledger_pending_proposal
      ON ledger_messages(unit_id, proposal_status, seq)
      WHERE kind = 'proposal_message';

      CREATE INDEX IF NOT EXISTS idx_unit_children_parent
      ON unit_children(parent_unit_id, child_key);

      CREATE INDEX IF NOT EXISTS idx_committed_steps_unit_recent
      ON committed_steps(unit_id, committed_at DESC);
    `);
    this.db.prepare(`
      INSERT INTO schema_meta (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(CURRENT_SCHEMA_VERSION);
  }
  saveUnitSnapshot(snapshot, sessionId, now) {
    this.db.prepare(`
      INSERT INTO units (
        unit_id, session_id, level, path, workspace_root, project_root,
        state, turn_counter, child_counter,
        sleep_deadline_ms, created_at, updated_at, terminated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(unit_id) DO UPDATE SET
        session_id = excluded.session_id,
        level = excluded.level,
        path = excluded.path,
        workspace_root = excluded.workspace_root,
        project_root = excluded.project_root,
        state = excluded.state,
        turn_counter = excluded.turn_counter,
        child_counter = excluded.child_counter,
        sleep_deadline_ms = excluded.sleep_deadline_ms,
        updated_at = excluded.updated_at,
        terminated_at = excluded.terminated_at
    `).run(
      snapshot.unitId,
      sessionId,
      snapshot.level,
      JSON.stringify(snapshot.path),
      snapshot.workspaceRoot,
      snapshot.projectRoot,
      snapshot.state,
      snapshot.turnCounter,
      snapshot.childCounter,
      snapshot.sleepDeadlineMs,
      now,
      now,
      snapshot.state === "terminated" ? now : null
    );
    this.saveLedgerSnapshot(snapshot.unitId, snapshot);
    this.saveCommittedSteps(snapshot.unitId, snapshot.commitLog);
    this.saveMemoryAndCompressionState(snapshot.unitId, snapshot);
    for (const child of snapshot.children) {
      this.saveUnitSnapshot(child.snapshot, sessionId, now);
    }
    this.saveChildRelations(snapshot.unitId, snapshot.children, now);
  }
  saveLedgerSnapshot(unitId, snapshot) {
    const ledgerSnapshot = snapshot.ledger;
    const upsertCursor = this.db.prepare(`
      INSERT INTO unit_agent_cursors (unit_id, agent_id, cursor_exclusive)
      VALUES (?, ?, ?)
      ON CONFLICT(unit_id, agent_id) DO UPDATE SET
        cursor_exclusive = excluded.cursor_exclusive
    `);
    for (const agentId of AGENT_IDS) {
      upsertCursor.run(
        unitId,
        agentId,
        toAgentCursorExclusive(ledgerSnapshot.sequenceStart, ledgerSnapshot.cursors[agentId])
      );
    }
  }
  saveCommittedSteps(unitId, commitLog) {
    this.db.prepare(`DELETE FROM committed_steps WHERE unit_id = ?`).run(unitId);
    const insertStep = this.db.prepare(`
      INSERT INTO committed_steps (
        unit_id, step_seq, tool_name, proposed_step, proposed_by, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    commitLog.forEach((step, index) => {
      insertStep.run(
        unitId,
        index + 1,
        step.toolName,
        step.proposedStep,
        step.proposedBy,
        step.committedAt
      );
    });
  }
  saveMemoryAndCompressionState(unitId, snapshot) {
    const ledgerSnapshot = snapshot.ledger;
    const memorySnapshot = snapshot.compression.memorySnapshot;
    const recentRawStartSeq = ledgerSnapshot.messages.length === 0 ? ledgerSnapshot.sequenceStart : ledgerSnapshot.sequenceStart + clamp(snapshot.compression.recentRawStartIndex, 0, ledgerSnapshot.messages.length - 1);
    if (memorySnapshot) {
      const metadata = JSON.stringify({
        sourceMessageCount: memorySnapshot.sourceMessageCount,
        requirements: memorySnapshot.requirements,
        recentRawStartSeq
      });
      this.saveContextTextHistoryInternal(unitId, "memory_snapshot", memorySnapshot.content, metadata, memorySnapshot.createdAt);
    }
    this.db.prepare(`
      INSERT INTO unit_compression_state (
        unit_id, active_task_id, requirements, source_message_count, attempt_number,
        max_attempts, started_at, reminder_threshold_chars, recent_raw_target_chars, max_retries
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(unit_id) DO UPDATE SET
        active_task_id = excluded.active_task_id,
        requirements = excluded.requirements,
        source_message_count = excluded.source_message_count,
        attempt_number = excluded.attempt_number,
        max_attempts = excluded.max_attempts,
        started_at = excluded.started_at,
        reminder_threshold_chars = excluded.reminder_threshold_chars,
        recent_raw_target_chars = excluded.recent_raw_target_chars,
        max_retries = excluded.max_retries
    `).run(
      unitId,
      snapshot.compression.activeTask?.id ?? null,
      snapshot.compression.activeTask?.requirements ?? null,
      snapshot.compression.activeTask?.sourceMessageCount ?? null,
      snapshot.compression.activeTask?.attemptNumber ?? null,
      snapshot.compression.activeTask?.maxAttempts ?? null,
      snapshot.compression.activeTask?.startedAt ?? null,
      snapshot.compression.reminderThresholdChars,
      snapshot.compression.recentRawTargetChars,
      snapshot.compression.maxRetries
    );
  }
  saveChildRelations(parentUnitId, children, now) {
    const upsertChild = this.db.prepare(`
      INSERT INTO unit_children (
        parent_unit_id, child_key, child_unit_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(parent_unit_id, child_key) DO UPDATE SET
        child_unit_id = excluded.child_unit_id,
        updated_at = excluded.updated_at
    `);
    for (const child of children) {
      upsertChild.run(
        parentUnitId,
        child.childId,
        child.snapshot.unitId,
        now,
        now
      );
    }
    if (children.length === 0) {
      this.db.prepare(`DELETE FROM unit_children WHERE parent_unit_id = ?`).run(parentUnitId);
      return;
    }
    const placeholders = children.map(() => "?").join(", ");
    this.db.prepare(`
      DELETE FROM unit_children
      WHERE parent_unit_id = ?
        AND child_key NOT IN (${placeholders})
    `).run(parentUnitId, ...children.map((child) => child.childId));
  }
  loadUnitSnapshot(unitId) {
    const unitRow = this.db.prepare(`
        SELECT unit_id, level, path, workspace_root, project_root, state, turn_counter, child_counter, sleep_deadline_ms
        FROM units
        WHERE unit_id = ?
      `).get(unitId);
    if (!unitRow) {
      throw new Error(`Persisted unit ${unitId} not found in SQLite session store.`);
    }
    const totalMessages = this.db.prepare(`SELECT COALESCE(MAX(seq), 0) AS total FROM ledger_messages WHERE unit_id = ?`).get(unitId)?.total ?? 0;
    const pendingProposalSeq = this.db.prepare(`
        SELECT MIN(seq) AS seq
        FROM (
          SELECT seq, proposal_status, ROW_NUMBER() OVER (
            PARTITION BY message_id ORDER BY version DESC
          ) AS rn
          FROM ledger_messages
          WHERE unit_id = ? AND kind = 'proposal_message'
        )
        WHERE rn = 1 AND proposal_status = 'pending'
      `).get(unitId)?.seq;
    const memoryRow = this.db.prepare(`
        SELECT rowid, content, metadata, created_at
        FROM context_text_history
        WHERE unit_id = ? AND category = 'memory_snapshot'
        ORDER BY rowid DESC LIMIT 1
      `).get(unitId);
    const compressionRow = this.db.prepare(`
        SELECT active_task_id, requirements, source_message_count, attempt_number,
               max_attempts, started_at, reminder_threshold_chars,
               recent_raw_target_chars, max_retries
        FROM unit_compression_state
        WHERE unit_id = ?
      `).get(unitId);
    const sequenceStart = this.computeSequenceStart(totalMessages, memoryRow, pendingProposalSeq ?? null);
    const messages = this.db.prepare(`
        SELECT body FROM (
          SELECT body, seq, ROW_NUMBER() OVER (
            PARTITION BY message_id ORDER BY version DESC
          ) AS rn
          FROM ledger_messages
          WHERE unit_id = ? AND seq >= ?
        ) WHERE rn = 1
        ORDER BY seq ASC
      `).all(unitId, sequenceStart);
    const restoredMessages = messages.map((row) => parseJson(row.body));
    const cursorRows = this.db.prepare(`
        SELECT agent_id, cursor_exclusive
        FROM unit_agent_cursors
        WHERE unit_id = ?
      `).all(unitId);
    const cursorMap = new Map(cursorRows.map((row) => [row.agent_id, row.cursor_exclusive]));
    const cursors = {
      "agent-a": this.toRelativeCursor(cursorMap.get("agent-a") ?? 0, sequenceStart, restoredMessages.length),
      "agent-b": this.toRelativeCursor(cursorMap.get("agent-b") ?? 0, sequenceStart, restoredMessages.length)
    };
    const memorySnapshot = this.buildMemorySnapshot(memoryRow);
    const compressionSnapshot = this.buildCompressionSnapshot(
      compressionRow,
      memorySnapshot,
      memoryRow,
      sequenceStart,
      restoredMessages.length
    );
    const commitLog = this.db.prepare(`
        SELECT tool_name, proposed_step, proposed_by, committed_at
        FROM committed_steps
        WHERE unit_id = ?
        ORDER BY step_seq ASC
      `).all(unitId);
    const childRows = this.db.prepare(`
        SELECT child_key, child_unit_id
        FROM unit_children
        WHERE parent_unit_id = ?
        ORDER BY child_key ASC
      `).all(unitId);
    return {
      unitId: unitRow.unit_id,
      level: unitRow.level,
      path: parseJson(unitRow.path),
      workspaceRoot: unitRow.workspace_root,
      projectRoot: unitRow.project_root,
      state: unitRow.state,
      turnCounter: unitRow.turn_counter,
      childCounter: unitRow.child_counter,
      sleepDeadlineMs: unitRow.sleep_deadline_ms,
      ledger: {
        sequenceStart,
        totalMessages,
        messages: restoredMessages,
        cursors
      },
      compression: compressionSnapshot,
      commitLog: commitLog.map((step) => ({
        toolName: step.tool_name,
        proposedStep: step.proposed_step,
        proposedBy: step.proposed_by,
        committedAt: step.committed_at
      })),
      children: childRows.map((child) => ({
        childId: child.child_key,
        snapshot: this.loadUnitSnapshot(child.child_unit_id)
      }))
    };
  }
  computeSequenceStart(totalMessages, memoryRow, pendingProposalSeq) {
    if (totalMessages <= 0) {
      return 1;
    }
    let start = 1;
    if (memoryRow?.content) {
      const meta = memoryRow.metadata ? JSON.parse(memoryRow.metadata) : {};
      start = clamp(meta.recentRawStartSeq ?? 1, 1, totalMessages);
    }
    if (pendingProposalSeq !== null) {
      start = Math.min(start, pendingProposalSeq);
    }
    return start;
  }
  toRelativeCursor(cursorExclusive, sequenceStart, messageCount) {
    return clamp(cursorExclusive - (sequenceStart - 1), 0, messageCount);
  }
  buildMemorySnapshot(row) {
    if (!row?.content) {
      return null;
    }
    const meta = row.metadata ? JSON.parse(row.metadata) : {};
    return {
      content: row.content,
      sourceMessageCount: meta.sourceMessageCount ?? 0,
      requirements: meta.requirements ?? "",
      createdAt: row.created_at ?? 0
    };
  }
  buildCompressionSnapshot(row, memorySnapshot, memoryRow, sequenceStart, messageCount) {
    const meta = memoryRow?.metadata ? JSON.parse(memoryRow.metadata) : {};
    const recentRawStartIndex = memoryRow?.content ? clamp((meta.recentRawStartSeq ?? 1) - sequenceStart, 0, messageCount) : 0;
    return {
      activeTask: row?.active_task_id ? {
        id: row.active_task_id,
        requirements: row.requirements ?? "",
        sourceMessageCount: row.source_message_count ?? 0,
        attemptNumber: row.attempt_number ?? 1,
        maxAttempts: row.max_attempts ?? DEFAULT_MAX_RETRIES + 1,
        startedAt: row.started_at ?? 0
      } : null,
      memorySnapshot,
      recentRawStartIndex,
      reminderThresholdChars: row?.reminder_threshold_chars ?? DEFAULT_REMINDER_THRESHOLD_CHARS,
      recentRawTargetChars: row?.recent_raw_target_chars ?? DEFAULT_RECENT_RAW_TARGET_CHARS,
      maxRetries: row?.max_retries ?? DEFAULT_MAX_RETRIES
    };
  }
  saveContextTextHistoryInternal(unitId, category, content, metadata, createdAt) {
    const contentHash = createHash("sha256").update(content).digest("hex");
    const existing = this.db.prepare(
      `SELECT rowid FROM context_text_history WHERE unit_id = ? AND category = ? AND content_hash = ?`
    ).get(unitId, category, contentHash);
    if (existing) {
      return existing.rowid;
    }
    const result = this.db.prepare(
      `INSERT INTO context_text_history (unit_id, category, content_hash, content, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(unitId, category, contentHash, content, metadata, createdAt);
    return Number(result.lastInsertRowid);
  }
  saveContextTextHistory(unitId, category, content, metadata) {
    return this.saveContextTextHistoryInternal(unitId, category, content, metadata, Date.now());
  }
  getLatestContextTextHistory(unitId, category) {
    const row = this.db.prepare(
      `SELECT rowid, content, metadata FROM context_text_history WHERE unit_id = ? AND category = ? ORDER BY rowid DESC LIMIT 1`
    ).get(unitId, category);
    if (!row) return null;
    return { rowid: row.rowid, content: row.content, metadata: row.metadata };
  }
  createRecipe(recipe) {
    const result = this.db.prepare(
      `INSERT INTO context_recipe (
        unit_id, agent_id, recent_raw_start_seq, visible_end_seq, newly_visible_seq,
        memory_snapshot_rowid, agent_md_rowid, level,
        has_pending_from_other, has_children, can_spawn_child,
        compression_reminder_shown, compression_reminder_chars, compression_reminder_threshold_chars,
        truncation_applied, truncation_reason, truncation_level,
        effective_turn, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      recipe.unitId,
      recipe.agentId,
      recipe.recentRawStartSeq,
      recipe.visibleEndSeq,
      recipe.newlyVisibleSeq,
      recipe.memorySnapshotRowid,
      recipe.agentMdRowid,
      recipe.level,
      recipe.hasPendingFromOther ? 1 : 0,
      recipe.hasChildren ? 1 : 0,
      recipe.canSpawnChild ? 1 : 0,
      recipe.compressionReminderShown ? 1 : 0,
      recipe.compressionReminderChars,
      recipe.compressionReminderThresholdChars,
      recipe.truncationApplied ? 1 : 0,
      recipe.truncationReason,
      recipe.truncationLevel,
      recipe.effectiveTurn,
      Date.now()
    );
    return Number(result.lastInsertRowid);
  }
  updateRecipeOutputMessageId(recipeId, outputMessageId) {
    this.db.prepare(
      `UPDATE context_recipe SET output_message_id = ? WHERE recipe_id = ?`
    ).run(outputMessageId, recipeId);
  }
  getRecipeByOutputMessageId(messageId) {
    const row = this.db.prepare(
      `SELECT recipe_id, unit_id, agent_id, recent_raw_start_seq, visible_end_seq, newly_visible_seq,
              memory_snapshot_rowid, agent_md_rowid, level,
              has_pending_from_other, has_children, can_spawn_child,
              compression_reminder_shown, compression_reminder_chars, compression_reminder_threshold_chars,
              truncation_applied, truncation_reason, truncation_level, effective_turn
       FROM context_recipe WHERE output_message_id = ? LIMIT 1`
    ).get(messageId);
    if (!row) return null;
    return {
      unitId: row.unit_id,
      agentId: row.agent_id,
      recentRawStartSeq: row.recent_raw_start_seq,
      visibleEndSeq: row.visible_end_seq,
      newlyVisibleSeq: row.newly_visible_seq,
      memorySnapshotRowid: row.memory_snapshot_rowid,
      agentMdRowid: row.agent_md_rowid,
      level: row.level,
      hasPendingFromOther: row.has_pending_from_other !== 0,
      hasChildren: row.has_children !== 0,
      canSpawnChild: row.can_spawn_child !== 0,
      compressionReminderShown: row.compression_reminder_shown !== 0,
      compressionReminderChars: row.compression_reminder_chars,
      compressionReminderThresholdChars: row.compression_reminder_threshold_chars,
      truncationApplied: row.truncation_applied !== 0,
      truncationReason: row.truncation_reason === "budget_precheck" ? "capacity_guard" : row.truncation_reason,
      truncationLevel: row.truncation_level,
      effectiveTurn: row.effective_turn
    };
  }
  getContextTextHistoryByRowid(rowid) {
    const row = this.db.prepare(
      `SELECT content, metadata FROM context_text_history WHERE rowid = ?`
    ).get(rowid);
    if (!row) return null;
    return { content: row.content, metadata: row.metadata };
  }
  getLedgerMessagesBySeqRange(unitId, startSeq, endSeq) {
    const rows = this.db.prepare(
      `SELECT seq, body FROM (
        SELECT body, seq, message_id, version,
               ROW_NUMBER() OVER (PARTITION BY message_id ORDER BY version DESC) AS rn
        FROM ledger_messages
        WHERE unit_id = ? AND seq >= ? AND seq < ?
      ) WHERE rn = 1
      ORDER BY seq ASC`
    ).all(unitId, startSeq, endSeq);
    return rows.map((row) => ({
      seq: row.seq,
      message: parseJson(row.body)
    }));
  }
}
const store = new ElectronStore({
  name: "elenchus-config",
  defaults: {}
});
let session = null;
let persistence = null;
let workspaceRoot = "";
function getSession() {
  return session;
}
function getPersistence() {
  return persistence;
}
function getWorkspaceRoot() {
  return workspaceRoot;
}
function buildAgentTree(snapshot) {
  return {
    unitId: snapshot.unitId,
    level: snapshot.level,
    path: snapshot.path,
    state: snapshot.state,
    children: snapshot.children.map((child) => buildAgentTree(child.snapshot))
  };
}
function registerSessionIpc(sendToRenderer, fsWatcher) {
  ipcMain.handle("start-session", async (_event, config) => {
    if (session) {
      session.close();
      session = null;
    }
    const envVarMap = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
      xai: "XAI_API_KEY",
      deepseek: "DEEPSEEK_API_KEY"
    };
    const envVar = envVarMap[config.provider];
    if (envVar && config.apiKey) {
      process.env[envVar] = config.apiKey;
    }
    const llmClient = createPiAiLlmClient({
      provider: config.provider,
      modelName: config.modelName,
      baseUrl: config.baseUrl
    });
    if (!llmClient) {
      return { error: `Failed to create LLM client for ${config.provider}/${config.modelName}` };
    }
    workspaceRoot = join(homedir(), "Elenchus");
    const rawProjectRoot = config.projectRoot ?? process.cwd();
    const projectRoot = rawProjectRoot.startsWith("~") ? join(homedir(), rawProjectRoot.slice(1)) : rawProjectRoot;
    try {
      persistence = new SqliteSessionPersistence({ workspaceRoot, projectRoot });
      session = createSession({
        llmClient,
        toolExecutor: new LocalNodeToolExecutor(),
        workspaceRoot,
        projectRoot,
        level: config.level ?? void 0,
        persistence,
        onSystemEvent: (event) => {
          sendToRenderer("system-event", event);
          if (event.type === "child-spawned" || event.type === "state-transition" || event.type === "upward-message") {
            sendToRenderer("system-event", { type: "unit-tree-change" });
          }
        }
      });
      store.set("provider", config.provider);
      store.set("modelName", config.modelName);
      store.set("apiKey", config.apiKey);
      if (config.baseUrl) store.set("baseUrl", config.baseUrl);
      if (config.projectRoot) store.set("projectRoot", config.projectRoot);
      fsWatcher.updateRoot(workspaceRoot);
      const snapshot = session.exportSnapshot();
      return {
        unitId: snapshot.unitId,
        state: snapshot.state,
        level: snapshot.level,
        tree: buildAgentTree(snapshot)
      };
    } catch (err) {
      return { error: err.message ?? "Failed to start session" };
    }
  });
  ipcMain.handle("terminate-session", async () => {
    if (session) {
      session.terminate();
      session.close();
      session = null;
      persistence = null;
      return { ok: true };
    }
    return { ok: false, error: "No active session" };
  });
  ipcMain.handle("get-session-info", async () => {
    if (!session) return null;
    const snapshot = session.exportSnapshot();
    return {
      unitId: snapshot.unitId,
      state: snapshot.state,
      level: snapshot.level,
      tree: buildAgentTree(snapshot)
    };
  });
  ipcMain.handle("load-persisted-config", async () => {
    const provider = store.get("provider");
    const modelName = store.get("modelName");
    const apiKey = store.get("apiKey");
    const baseUrl = store.get("baseUrl");
    const projectRoot = store.get("projectRoot");
    if (!provider || !modelName) return null;
    return { provider, modelName, apiKey, baseUrl, projectRoot };
  });
  ipcMain.handle("save-persisted-config", async (_event, config) => {
    for (const [key, value] of Object.entries(config)) {
      if (value !== void 0) {
        store.set(key, value);
      }
    }
    return { ok: true };
  });
  ipcMain.handle("check-workspace-status", async () => {
    const workspaceRoot2 = join(homedir(), "Elenchus");
    const hasSession = existsSync(join(workspaceRoot2, "elenchus.db"));
    const provider = store.get("provider");
    const modelName = store.get("modelName");
    const baseUrl = store.get("baseUrl");
    const projectRoot = store.get("projectRoot");
    return {
      has_session: hasSession,
      config: provider && modelName ? { provider, modelName, baseUrl, projectRoot } : null
    };
  });
  ipcMain.handle("close-session", async () => {
    if (session) {
      session.close();
      session = null;
      persistence = null;
    }
  });
}
function normalizeTruncationReason(reason) {
  if (reason === "budget_precheck") return "capacity_guard";
  return reason;
}
function reconstructContext(deps, messageId) {
  const { persistence: persistence2, workspaceRoot: workspaceRoot2 } = deps;
  const rawRecipe = persistence2.getRecipeByOutputMessageId(messageId);
  if (!rawRecipe) return null;
  const recipe = {
    ...rawRecipe,
    truncationReason: normalizeTruncationReason(rawRecipe.truncationReason)
  };
  let workspaceKnowledge = null;
  if (recipe.agentMdRowid !== null) {
    const entry = persistence2.getContextTextHistoryByRowid(recipe.agentMdRowid);
    workspaceKnowledge = entry?.content ?? null;
  }
  if (workspaceKnowledge === null) {
    workspaceKnowledge = readRootAgentMd(workspaceRoot2);
  }
  const systemPrompt = buildSystemPrompt(
    recipe.agentId,
    recipe.level,
    workspaceRoot2,
    workspaceKnowledge
  );
  const sequencedMessages = persistence2.getLedgerMessagesBySeqRange(
    recipe.unitId,
    recipe.recentRawStartSeq,
    recipe.visibleEndSeq
  );
  const allMessages = sequencedMessages.map((entry) => entry.message);
  const projector = new ConversationProjector();
  let oldMessages = allMessages;
  let newMessages = [];
  if (recipe.newlyVisibleSeq !== null) {
    const splitIndex = allMessages.findIndex(
      (_message, index) => sequencedMessages[index].seq >= recipe.newlyVisibleSeq
    );
    if (splitIndex >= 0) {
      oldMessages = allMessages.slice(0, splitIndex);
      newMessages = allMessages.slice(splitIndex);
    }
  }
  const messages = [];
  if (recipe.memorySnapshotRowid !== null) {
    const entry = persistence2.getContextTextHistoryByRowid(recipe.memorySnapshotRowid);
    if (entry) {
      const meta = entry.metadata ? JSON.parse(entry.metadata) : {};
      messages.push(projector.buildMemorySnapshotMessage({
        content: entry.content,
        sourceMessageCount: meta.sourceMessageCount ?? 0,
        requirements: meta.requirements ?? "",
        createdAt: 0
      }));
    }
  }
  messages.push(...projector.projectVisibleMessages(oldMessages));
  if (newMessages.length > 0) {
    messages.push(projector.buildNewlyVisibleBoundaryOverlay(recipe.agentId, newMessages.length));
    messages.push(...projector.projectVisibleMessages(newMessages));
  }
  if (recipe.compressionReminderShown && recipe.compressionReminderChars !== null && recipe.compressionReminderThresholdChars !== null) {
    messages.push(projector.buildCompressionReminderOverlay(
      recipe.agentId,
      recipe.compressionReminderChars,
      recipe.compressionReminderThresholdChars
    ));
  }
  const tools = getBuiltInToolList(
    recipe.hasPendingFromOther,
    recipe.level,
    recipe.hasChildren,
    recipe.canSpawnChild
  );
  const toolNames = tools.map((t) => t.name);
  return { systemPrompt, messages, toolNames, recipe };
}
function formatContextAsMarkdown(ctx, messageId) {
  const { systemPrompt, messages, toolNames, recipe } = ctx;
  const agentName = recipe.agentId === "agent-a" ? "Agent A" : "Agent B";
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const sections = [];
  sections.push(`# Context Reconstruction`);
  sections.push(``);
  sections.push(`> **Unit**: ${recipe.unitId} | **Agent**: ${agentName} | **Turn**: ${recipe.effectiveTurn} | **Level**: ${recipe.level}`);
  sections.push(`> **Reconstructed at**: ${timestamp}`);
  sections.push(`> **Source message**: \`${messageId}\``);
  sections.push(``);
  sections.push(`---`);
  sections.push(``);
  sections.push(`## System Prompt`);
  sections.push(``);
  sections.push(systemPrompt);
  sections.push(``);
  sections.push(`---`);
  sections.push(``);
  sections.push(`## Messages`);
  sections.push(``);
  for (const msg of messages) {
    const role = msg.role === "user" ? "user" : "assistant";
    sections.push(`### [${role}]`);
    sections.push(``);
    sections.push(msg.content);
    sections.push(``);
  }
  sections.push(`---`);
  sections.push(``);
  sections.push(`## Available Tools`);
  sections.push(``);
  for (const name of toolNames) {
    sections.push(`- \`${name}\``);
  }
  sections.push(``);
  return sections.join("\n");
}
function registerDataIpc() {
  ipcMain.handle("get-unit-info", async (_event, unitId) => {
    const s = getSession();
    if (!s) return null;
    const unit = s.getRootUnit().findUnitById(unitId);
    if (!unit) return null;
    const snapshot = unit.exportSnapshot();
    return {
      unitId: snapshot.unitId,
      level: snapshot.level,
      path: snapshot.path,
      state: snapshot.state,
      turnCounter: snapshot.turnCounter,
      childCount: snapshot.children.length,
      commitLog: snapshot.commitLog
    };
  });
  ipcMain.handle("get-unit-messages", async (_event, unitId, opts) => {
    const s = getSession();
    if (!s) return [];
    const unit = s.getRootUnit().findUnitById(unitId);
    if (!unit) return [];
    const snapshot = unit.exportSnapshot();
    let messages = snapshot.ledger.messages;
    if (opts?.before !== void 0 && opts.before >= 0) {
      messages = messages.filter((_m, i) => {
        const seq = snapshot.ledger.sequenceStart + i;
        return seq < opts.before;
      });
    }
    const limit = opts?.limit ?? 50;
    const hasMore = messages.length > limit;
    const result = hasMore ? messages.slice(-limit) : messages;
    return result;
  });
  ipcMain.handle("send-message", async (_event, content) => {
    const s = getSession();
    if (!s) return { ok: false, error: "No active session" };
    console.log(`[IPC] send-message: "${content.slice(0, 100)}", unitState=${s.getState()}`);
    s.sendUserMessage(content);
    return { ok: true };
  });
  ipcMain.handle("get-fs-tree", async (_event, mode) => {
    const root = join(homedir(), "Elenchus");
    return buildFsTree(root, mode === "docs", 3);
  });
  ipcMain.handle("read-file", async (_event, filePath) => {
    try {
      const content = await readFile(filePath, "utf-8");
      const ext = extname(filePath).toLowerCase();
      return { path: filePath, content, extension: ext };
    } catch {
      return null;
    }
  });
  ipcMain.handle("reconstruct-context", async (_event, messageId) => {
    const persistence2 = getPersistence();
    if (!persistence2) {
      return { ok: false, error: "No active session persistence" };
    }
    const wsRoot = getWorkspaceRoot();
    const ctx = reconstructContext({ persistence: persistence2, workspaceRoot: wsRoot }, messageId);
    if (!ctx) {
      return { ok: false, error: "No context recipe found for this message. Early messages may not have recipe records." };
    }
    const markdown = formatContextAsMarkdown(ctx, messageId);
    const dumpDir = join(wsRoot, "context-dumps");
    await mkdir(dumpDir, { recursive: true });
    const fileName = `context-${ctx.recipe.unitId}-${ctx.recipe.agentId}-turn${ctx.recipe.effectiveTurn}.md`;
    const filePath = join(dumpDir, fileName);
    await writeFile(filePath, markdown, "utf-8");
    return { ok: true, path: filePath, name: fileName };
  });
}
async function buildFsTree(dirPath, docsOnly, maxDepth) {
  if (maxDepth <= 0) return [];
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes = [];
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".")) continue;
    const fullPath = join(dirPath, name);
    if (entry.isDirectory()) {
      const children = await buildFsTree(fullPath, docsOnly, maxDepth - 1);
      if (docsOnly && children.length === 0) continue;
      nodes.push({ name, path: fullPath, isDirectory: true, children });
    } else if (entry.isFile()) {
      if (docsOnly && extname(name).toLowerCase() !== ".md") continue;
      nodes.push({ name, path: fullPath, isDirectory: false });
    }
  }
  return nodes;
}
function registerConfigIpc() {
  ipcMain.handle("get-providers", async () => {
    try {
      const { getProviders } = await import("@mariozechner/pi-ai");
      const providers = getProviders();
      return providers.map((id) => ({ id, name: id }));
    } catch {
      return [];
    }
  });
  ipcMain.handle("get-models", async (_event, provider) => {
    try {
      const { getModels } = await import("@mariozechner/pi-ai");
      const models = getModels(provider);
      return models.map((m) => ({ id: m.id, name: m.name }));
    } catch {
      return [];
    }
  });
  ipcMain.handle("validate-config", async (_event, config) => {
    try {
      const { createPiAiLlmClient: createPiAiLlmClient2 } = await Promise.resolve().then(() => piAiClient);
      const client = createPiAiLlmClient2(config);
      if (!client) {
        return { valid: false, error: `Could not create model: ${config.provider}/${config.modelName}` };
      }
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  });
}
const DEBOUNCE_MS = 100;
function createFsWatcher(root, callback) {
  let watcher = null;
  let pending = /* @__PURE__ */ new Map();
  let timer = null;
  let currentRoot = root;
  function start() {
    close();
    try {
      watcher = watch(currentRoot, { recursive: true, persistent: false }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = join(currentRoot, filename);
        if (filename.startsWith(".elenchus-state") || filename.includes(".elenchus-state/")) return;
        const kind = classifyChange(eventType, fullPath);
        pending.set(fullPath, { path: fullPath, kind });
        scheduleFlush();
      });
    } catch (err) {
      process.stderr.write(`[fs-watcher] Failed to start: ${err}
`);
    }
  }
  function close() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    pending.clear();
  }
  function updateRoot(newRoot) {
    currentRoot = newRoot;
    if (watcher) start();
  }
  function classifyChange(eventType, fullPath) {
    if (eventType === "change") return "update";
    return existsSync(fullPath) ? "create" : "delete";
  }
  function scheduleFlush() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, DEBOUNCE_MS);
  }
  function flush() {
    if (pending.size === 0) return;
    const changes = Array.from(pending.values());
    pending.clear();
    callback(changes);
  }
  return { start, close, updateRoot };
}
process.on("uncaughtException", (error) => {
  console.error("[main] Uncaught Exception:", error);
  dialog.showErrorBox("Elenchus - Main Process Error", error.message + "\n\n" + error.stack);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] Unhandled Rejection:", reason);
});
let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Elenchus",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.openDevTools();
  }
}
app.whenReady().then(() => {
  createWindow();
  const sendToRenderer = (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };
  const fsWatcher = createFsWatcher(
    join(homedir(), "Elenchus"),
    (changes) => sendToRenderer("fs-change", { type: "fs-change", changes })
  );
  registerSessionIpc(sendToRenderer, fsWatcher);
  registerDataIpc();
  registerConfigIpc();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  app.quit();
});
