// Elenchus MVP - Tool Definitions
// L0 has only two tools: Report (always available) and Vote (conditionally injected).
// Tool calls are proposals (framework-design §2.4) — they are NOT auto-executed.

import { Type, type TObject } from "@sinclair/typebox";

// pi-ai Tool interface (subset we need)
export interface ElenchusTool {
  name: string;
  description: string;
  parameters: TObject;
}

// Report: agent proposes to deliver final conclusions to the parent (user).
// Constitutes a proposal — requires the other agent's APPROVE vote.
export const reportTool: ElenchusTool = {
  name: "report",
  description:
    "Propose to deliver final conclusions and end the deliberation. " +
    "This is a PROPOSAL — the other agent must vote APPROVE before it takes effect. " +
    "Use this when you believe the discussion has sufficiently converged on a reliable answer.",
  parameters: Type.Object({
    content: Type.String({
      description: "The final report content: a clear, comprehensive summary of the conclusions reached.",
    }),
  }),
};

// Vote: conditionally injected by the framework when there is a pending proposal.
// This is the ONLY tool that does not constitute a new proposal.
export const voteTool: ElenchusTool = {
  name: "vote",
  description:
    "Vote on the other agent's pending proposal. You MUST call this tool when a pending proposal is presented to you. " +
    "APPROVE if the proposal is accurate and complete. REJECT if it has significant issues.",
  parameters: Type.Object({
    approve: Type.Boolean({
      description: "true = APPROVE the proposal, false = REJECT it",
    }),
    reason: Type.String({
      description: "Reason for your vote. If rejecting, explain what needs to change.",
    }),
  }),
};

// Build the tool list for a given turn.
// Vote is only available when there is a pending proposal from the other agent.
export function buildToolList(hasPendingProposal: boolean): ElenchusTool[] {
  const tools: ElenchusTool[] = [reportTool];
  if (hasPendingProposal) {
    tools.push(voteTool);
  }
  return tools;
}
