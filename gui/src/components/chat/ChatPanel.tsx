// Elenchus GUI - Chat Panel Component
// Displays conversation messages for a selected unit with input area (L0 only).

import { useState, useRef, useEffect } from "react";
import type { ConversationMessage, SessionInfo, AgentTreeNode, AgentId, ProposalStatus } from "../../lib/types";

interface ChatPanelProps {
  unitId: string | null;
  sessionInfo: SessionInfo | null;
  messages: ConversationMessage[];
  onSendMessage: (content: string) => Promise<void>;
}

function agentColor(agent: AgentId): string {
  return agent === "agent-a" ? "text-cyan-600" : "text-amber-600";
}

function agentBg(agent: AgentId): string {
  return agent === "agent-a" ? "bg-cyan-50 border-cyan-200" : "bg-amber-50 border-amber-200";
}

function proposalStatusBadge(status: ProposalStatus): { label: string; cls: string } {
  switch (status) {
    case "pending": return { label: "pending", cls: "bg-yellow-100 text-yellow-700" };
    case "approved": return { label: "approved", cls: "bg-green-100 text-green-700" };
    case "rejected": return { label: "rejected", cls: "bg-red-100 text-red-700" };
    case "superseded": return { label: "superseded", cls: "bg-gray-100 text-gray-500" };
  }
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const [expanded, setExpanded] = useState(false);

  switch (message.kind) {
    case "incoming_message":
      return (
        <div className="flex justify-end mb-2">
          <div className="max-w-[80%] bg-indigo-500 text-white rounded-2xl rounded-br-sm px-3 py-2 text-sm">
            {message.content}
          </div>
        </div>
      );

    case "agent_message":
      return (
        <div className="flex justify-start mb-2">
          <div className={`max-w-[80%] border rounded-2xl rounded-bl-sm px-3 py-2 text-sm ${agentBg(message.authoredBy)}`}>
            <span className={`font-semibold text-xs ${agentColor(message.authoredBy)}`}>
              {message.authoredBy === "agent-a" ? "Agent A" : "Agent B"}
            </span>
            <div className="mt-0.5 text-gray-800 whitespace-pre-wrap">{message.content}</div>
          </div>
        </div>
      );

    case "proposal_message": {
      const badge = proposalStatusBadge(message.status);
      return (
        <div className="mb-2">
          <div
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white cursor-pointer hover:bg-gray-50"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-2">
              <span className={`font-semibold text-xs ${agentColor(message.authoredBy)}`}>
                {message.authoredBy === "agent-a" ? "Agent A" : "Agent B"}
              </span>
              <span className="font-medium text-gray-700">propose:</span>
              <span className="text-gray-600">{message.toolName}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
              <span className="text-xs text-gray-400 ml-auto">{expanded ? "▾" : "▸"}</span>
            </div>
            <div className="text-gray-500 text-xs mt-1">{message.proposedStep}</div>
            {expanded && (
              <pre className="mt-2 text-xs bg-gray-50 rounded p-2 overflow-x-auto text-gray-600">
                {JSON.stringify(message.args, null, 2)}
              </pre>
            )}
          </div>
        </div>
      );
    }

    case "vote_message":
      return (
        <div className="mb-1">
          <div
            className="text-sm cursor-pointer hover:bg-gray-50 rounded px-2 py-1"
            onClick={() => setExpanded(!expanded)}
          >
            <span className={`font-semibold text-xs ${agentColor(message.authoredBy)}`}>
              {message.authoredBy === "agent-a" ? "Agent A" : "Agent B"}
            </span>
            <span className={`ml-1 text-xs font-medium ${message.approve ? "text-green-600" : "text-red-600"}`}>
              {message.approve ? "✓ Approve" : "✗ Reject"}
            </span>
            <span className="text-gray-500 text-xs ml-2">
              {expanded ? message.reason : message.reason.slice(0, 80) + (message.reason.length > 80 ? "..." : "")}
            </span>
          </div>
        </div>
      );

    case "tool_result_message":
      return (
        <div className="mb-2">
          <div
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 cursor-pointer hover:bg-gray-100"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-2">
              <span className={`font-medium ${message.success ? "text-green-600" : "text-red-600"}`}>
                {message.success ? "✓" : "✗"}
              </span>
              <span className="text-gray-700">{message.toolName}</span>
              <span className="text-xs text-gray-400">{(message.durationMs / 1000).toFixed(1)}s</span>
              <span className="text-xs text-gray-400 ml-auto">{expanded ? "▾" : "▸"}</span>
            </div>
            {expanded && (
              <pre className="mt-2 text-xs bg-white rounded p-2 overflow-x-auto max-h-60 overflow-y-auto text-gray-600 border border-gray-200">
                {message.output}
              </pre>
            )}
          </div>
        </div>
      );

    case "child_report_message":
      return (
        <div className="mb-2">
          <div
            className="border-l-4 border-indigo-300 bg-indigo-50/50 rounded-r-lg px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-indigo-600">{message.childId}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                message.deliveryMode === "yield" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
              }`}>
                {message.deliveryMode}
              </span>
              <span className="text-xs text-gray-400 ml-auto">{expanded ? "▾" : "▸"}</span>
            </div>
            {expanded ? (
              <div className="mt-1 text-gray-600">{message.content}</div>
            ) : (
              <div className="mt-1 text-gray-500 text-xs truncate">{message.content}</div>
            )}
          </div>
        </div>
      );

    case "upward_message":
      return (
        <div className="mb-2">
          <div className="border-l-4 border-purple-300 bg-purple-50/50 rounded-r-lg px-3 py-2 text-sm">
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
              message.deliveryMode === "yield" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
            }`}>
              {message.deliveryMode}
            </span>
            <div className="mt-1 text-gray-700">{message.content}</div>
          </div>
        </div>
      );

    case "system_message":
      return (
        <div className="flex justify-center mb-2">
          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-3 py-1">{message.content}</span>
        </div>
      );
  }
}

function buildBreadcrumb(sessionInfo: SessionInfo | null, unitId: string | null): { unitId: string; label: string }[] {
  if (!sessionInfo || !unitId) return [];
  const crumbs: { unitId: string; label: string }[] = [];

  function findPath(node: AgentTreeNode, target: string, path: { unitId: string; label: string }[]): boolean {
    path.push({ unitId: node.unitId, label: `${node.level}: ${node.unitId}` });
    if (node.unitId === target) return true;
    for (const child of node.children) {
      if (findPath(child, target, path)) return true;
    }
    path.pop();
    return false;
  }

  findPath(sessionInfo.tree, unitId, crumbs);
  return crumbs;
}

export function ChatPanel({ unitId, sessionInfo, messages, onSendMessage }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isL0 = unitId === sessionInfo?.unitId;
  const crumbs = buildBreadcrumb(sessionInfo, unitId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-white">
        {crumbs.map((crumb, i) => (
          <span key={crumb.unitId} className="flex items-center gap-2 text-sm">
            {i > 0 && <span className="text-gray-300">›</span>}
            <span className={i === crumbs.length - 1 ? "font-medium text-gray-800" : "text-gray-400 hover:text-gray-600 cursor-pointer"}>
              {crumb.label}
            </span>
          </span>
        ))}
        {unitId && sessionInfo && (
          <span className="ml-auto text-xs text-gray-400">
            {sessionInfo.level} · {sessionInfo.state}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 text-sm mt-8">No messages yet</div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {isL0 ? (
        <div className="border-t border-gray-200 bg-white px-4 py-3">
          <div className="flex gap-2">
            <textarea
              className="flex-1 resize-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200"
              rows={2}
              placeholder="Type your message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="self-end px-4 py-2 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-600 disabled:opacity-50"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              Send
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 text-center text-xs text-gray-400">
          This is a child unit conversation view. Messages can only be sent from the L0 layer.
          Use the breadcrumb navigation to return to L0.
        </div>
      )}
    </div>
  );
}
