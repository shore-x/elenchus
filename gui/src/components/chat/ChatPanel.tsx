// Elenchus GUI - Chat Panel Component
// Displays conversation messages for a selected unit with input area (L0 only).
// Drop zone for PreviewPanel's custom drag-to-reference (marked via data-drop-zone).

import { useState, useRef, useEffect, useCallback } from "react";
import type { ConversationMessage, SessionInfo, AgentTreeNode, AgentId, ProposalStatus, FileReference } from "../../lib/types";
import { renderInlineContent } from "../../lib/inline-render";

interface ChatPanelProps {
  unitId: string | null;
  sessionInfo: SessionInfo | null;
  messages: ConversationMessage[];
  onSendMessage: (content: string) => Promise<void>;
  onSelectUnit: (unitId: string) => void;
  onOpenFile: (path: string, name: string, startLine?: number) => void;
  refs: FileReference[];
  onRemoveRef: (index: number) => void;
}

function agentTagClass(agent: AgentId): string {
  return agent === "agent-a" ? "bg-sky-50 text-sky-500" : "bg-indigo-50 text-indigo-500";
}

function agentBorderClass(agent: AgentId): string {
  return agent === "agent-a" ? "border-l-2 border-sky-200" : "border-l-2 border-indigo-200";
}

function proposalStatusBadge(status: ProposalStatus): { label: string; cls: string } {
  switch (status) {
    case "pending": return { label: "pending", cls: "bg-stone-100 text-stone-600" };
    case "approved": return { label: "approved", cls: "bg-emerald-50 text-emerald-500" };
    case "rejected": return { label: "rejected", cls: "bg-stone-100 text-stone-400" };
    case "superseded": return { label: "superseded", cls: "bg-stone-50 text-stone-400" };
  }
}

function MessageBubble({ message, onOpenFile }: { message: ConversationMessage; onOpenFile: (path: string, name: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  switch (message.kind) {
    case "incoming_message":
      return (
        <div className="flex justify-end mb-3">
          <div className="max-w-[80%] bg-stone-100 text-gray-800 rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed">
            {renderInlineContent(message.content, { onOpenFile })}
          </div>
        </div>
      );

    case "agent_message":
      return (
        <div className="flex justify-start mb-3">
          <div className={`max-w-[80%] bg-white border border-stone-200 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed ${agentBorderClass(message.authoredBy)}`}>
            <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${agentTagClass(message.authoredBy)}`}>
              {message.authoredBy === "agent-a" ? "Agent A" : "Agent B"}
            </span>
            <div className="mt-1 text-gray-800">{renderInlineContent(message.content, { onOpenFile })}</div>
          </div>
        </div>
      );

    case "proposal_message": {
      const badge = proposalStatusBadge(message.status);
      return (
        <div className="mb-3">
          <div
            className="bg-white border border-stone-200 rounded-xl px-4 py-2.5 text-sm leading-relaxed cursor-pointer hover:bg-stone-50"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-2">
              <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${agentTagClass(message.authoredBy)}`}>
                {message.authoredBy === "agent-a" ? "Agent A" : "Agent B"}
              </span>
              <span className="font-medium text-gray-600">propose:</span>
              <span className="text-gray-600">{message.toolName}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
              <span className="text-xs text-gray-400 ml-auto">{expanded ? "▾" : "▸"}</span>
            </div>
            <div className="text-gray-500 text-xs mt-1">{message.proposedStep}</div>
            {expanded && (
              <pre className="mt-2 text-xs bg-stone-50 rounded-lg p-3 overflow-x-auto text-gray-600">
                {JSON.stringify(message.args, null, 2)}
              </pre>
            )}
          </div>
        </div>
      );
    }

    case "vote_message":
      return (
        <div className="mb-2">
          <div
            className="text-sm leading-relaxed cursor-pointer hover:bg-stone-100 rounded-lg px-3 py-1.5"
            onClick={() => setExpanded(!expanded)}
          >
            <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${agentTagClass(message.authoredBy)}`}>
              {message.authoredBy === "agent-a" ? "Agent A" : "Agent B"}
            </span>
            <span className={`ml-1 text-xs font-medium ${message.approve ? "text-stone-600" : "text-stone-500"}`}>
              {message.approve ? "Approve" : "Reject"}
            </span>
            <span className="text-gray-500 text-xs ml-2">
              {expanded ? message.reason : message.reason.slice(0, 80) + (message.reason.length > 80 ? "..." : "")}
            </span>
          </div>
        </div>
      );

    case "tool_result_message":
      return (
        <div className="mb-3">
          <div
            className="bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm leading-relaxed cursor-pointer hover:bg-stone-100/80"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-2">
              <span className={`font-medium ${message.success ? "text-emerald-500" : "text-stone-400"}`}>
                {message.success ? "Success" : "Failed"}
              </span>
              <span className="text-gray-700">{message.toolName}</span>
              <span className="text-xs text-gray-400">{(message.durationMs / 1000).toFixed(1)}s</span>
              <span className="text-xs text-gray-400 ml-auto">{expanded ? "▾" : "▸"}</span>
            </div>
            {expanded && (
              <pre className="mt-2 text-xs bg-white rounded-lg p-3 overflow-x-auto max-h-60 overflow-y-auto text-gray-600 border border-stone-200">
                {message.output}
              </pre>
            )}
          </div>
        </div>
      );

    case "child_report_message":
      return (
        <div className="mb-3">
          <div
            className="bg-white border border-stone-200 rounded-xl px-4 py-2.5 text-sm leading-relaxed cursor-pointer hover:bg-stone-50"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600">{message.childId}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                message.deliveryMode === "yield" ? "bg-stone-200 text-stone-700" : "bg-stone-100 text-stone-600"
              }`}>
                {message.deliveryMode}
              </span>
              <span className="text-xs text-gray-400 ml-auto">{expanded ? "▾" : "▸"}</span>
            </div>
            {expanded ? (
              <div className="mt-1 text-gray-600">{renderInlineContent(message.content, { onOpenFile })}</div>
            ) : (
              <div className="mt-1 text-gray-500 text-xs truncate">{message.content}</div>
            )}
          </div>
        </div>
      );

    case "upward_message":
      return (
        <div className="mb-3">
          <div className="bg-white border border-stone-200 rounded-xl px-4 py-2.5 text-sm leading-relaxed">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              message.deliveryMode === "yield" ? "bg-stone-200 text-stone-700" : "bg-stone-100 text-stone-600"
            }`}>
              {message.deliveryMode}
            </span>
            <div className="mt-1 text-gray-700">{renderInlineContent(message.content, { onOpenFile })}</div>
          </div>
        </div>
      );

    case "system_message":
      return (
        <div className="flex justify-center mb-3">
          <span className="text-xs text-stone-500 bg-stone-100 rounded-full px-3 py-1">{message.content}</span>
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

type SendKeyMode = "cmd-enter" | "enter";

const SEND_KEY_LABEL: Record<SendKeyMode, string> = {
  "cmd-enter": "⌘↵",
  "enter": "↵",
};

function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
}

function formatRefForMessage(ref: FileReference): string {
  return `@${ref.path}:${formatLineRange(ref.startLine, ref.endLine)}`;
}

export function ChatPanel({ unitId, sessionInfo, messages, onSendMessage, onSelectUnit, onOpenFile, refs, onRemoveRef }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [sendKeyMode, setSendKeyMode] = useState<SendKeyMode>("cmd-enter");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isL0 = unitId === sessionInfo?.unitId;
  const crumbs = buildBreadcrumb(sessionInfo, unitId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text && refs.length === 0) return;

    let content = text;
    if (refs.length > 0) {
      const refLine = refs.map(formatRefForMessage).join(" ");
      content = content
        ? `${content} ${refLine}`
        : refLine;
    }

    onSendMessage(content);
    setInput("");
  }, [input, refs, onSendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const isCmd = e.metaKey || e.ctrlKey;
    if (sendKeyMode === "cmd-enter") {
      // Cmd+Enter sends, plain Enter is newline
      if (e.key === "Enter" && isCmd && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    } else {
      // Enter sends, Cmd+Enter is newline
      if (e.key === "Enter" && !isCmd && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }
  }, [sendKeyMode, handleSend]);

  return (
    <div data-drop-zone="chat-input" className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-stone-200/80 bg-white/80 backdrop-blur-sm">
        {crumbs.map((crumb, i) => (
          <span key={crumb.unitId} className="flex items-center gap-2 text-sm">
            {i > 0 && <span className="text-stone-300">›</span>}
            <span
              className={i === crumbs.length - 1 ? "font-medium text-gray-700" : "text-gray-500 hover:text-gray-700 cursor-pointer hover:underline"}
              onClick={() => onSelectUnit(crumb.unitId)}
            >
              {crumb.label}
            </span>
          </span>
        ))}
        {unitId && sessionInfo && (
          <span className="ml-auto text-xs text-stone-400">
            {sessionInfo.level} · {sessionInfo.state}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 bg-[var(--color-bg)]">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 text-sm mt-8">No messages yet</div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} onOpenFile={onOpenFile} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {isL0 ? (
        <div
          className="border-t border-stone-200/80 bg-white/80 backdrop-blur-sm px-4 py-3 transition-colors duration-150"
        >
          {/* Reference chips */}
          <div data-ref-chips className="flex flex-wrap gap-1.5 mb-2 min-h-[0px]">
            {refs.length > 0 && refs.map((ref, i) => (
              <span key={`${ref.path}:${ref.startLine}-${ref.endLine}`} className="ref-chip ref-chip-appear">
                @{(() => {
                  const segs = ref.path.split("/").filter(Boolean);
                  const short = segs.length <= 2 ? segs.join("/") : segs.slice(-2).join("/");
                  return `${short}:${formatLineRange(ref.startLine, ref.endLine)}`;
                })()}
                <span
                  className="ref-chip-remove"
                  onClick={() => onRemoveRef(i)}
                >
                  ×
                </span>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <textarea
              className="flex-1 resize-none border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-stone-400 focus:ring-1 focus:ring-stone-200"
              rows={2}
              placeholder={refs.length > 0 ? "Add a message (optional)..." : "Type your message..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div ref={dropdownRef} className="relative self-end flex">
              <button
                className="px-3 py-2 bg-stone-700 text-white rounded-l-lg text-sm font-medium hover:bg-stone-600 disabled:opacity-50 min-w-[5.5rem]"
                onClick={handleSend}
                disabled={!input.trim() && refs.length === 0}
              >
                Send <span className="text-stone-300 text-xs ml-0.5 inline-block w-[1.5em] text-center">{SEND_KEY_LABEL[sendKeyMode]}</span>
              </button>
              <button
                className={`px-1.5 py-2 bg-stone-700 text-white rounded-r-lg text-sm font-medium hover:bg-stone-600 border-l border-stone-600 ${(!input.trim() && refs.length === 0) ? "opacity-50" : ""}`}
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                ▾
              </button>
              {dropdownOpen && (
                <div className="absolute bottom-full right-0 mb-1 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[160px] z-10">
                  <button
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-stone-50 flex items-center justify-between ${sendKeyMode === "cmd-enter" ? "text-stone-700 font-medium" : "text-gray-600"}`}
                    onClick={() => { setSendKeyMode("cmd-enter"); setDropdownOpen(false); }}
                  >
                    <span>⌘+Enter 发送</span>
                    {sendKeyMode === "cmd-enter" && <span className="text-xs text-stone-500">●</span>}
                  </button>
                  <button
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-stone-50 flex items-center justify-between ${sendKeyMode === "enter" ? "text-stone-700 font-medium" : "text-gray-600"}`}
                    onClick={() => { setSendKeyMode("enter"); setDropdownOpen(false); }}
                  >
                    <span>Enter 发送</span>
                    {sendKeyMode === "enter" && <span className="text-xs text-stone-500">●</span>}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="border-t border-stone-200 bg-stone-50 px-4 py-3 text-center text-xs text-stone-400">
          This is a child unit conversation view. Messages can only be sent from the L0 layer.
          Use the breadcrumb navigation to return to L0.
        </div>
      )}
    </div>
  );
}
