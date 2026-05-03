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
  onViewContext: (messageId: string) => void;
  refs: FileReference[];
  onRemoveRef: (index: number) => void;
}

function agentTagClass(agent: AgentId): string {
  return agent === "agent-a" ? "ui-badge ui-badge-identity-a" : "ui-badge ui-badge-identity-b";
}

function proposalStatusBadge(status: ProposalStatus): { label: string; cls: string } {
  switch (status) {
    case "pending": return { label: "pending", cls: "ui-badge ui-badge-status-muted" };
    case "approved": return { label: "approved", cls: "ui-badge ui-badge-status-success" };
    case "rejected": return { label: "rejected", cls: "ui-badge ui-badge-status-danger" };
    case "superseded": return { label: "superseded", cls: "ui-badge ui-badge-status-muted" };
  }
}

function deliveryModeBadgeClass(mode: "report" | "yield"): string {
  return mode === "yield" ? "ui-badge ui-badge-status-warning" : "ui-badge ui-badge-status-muted";
}

function ContextMenuPopup({ x, y, onAction }: { x: number; y: number; onAction: () => void }) {
  return (
    <div
      className="overlay-menu"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="overlay-menu-item"
        onClick={onAction}
      >
        View Context
      </button>
    </div>
  );
}

function MessageBubble({ message, onOpenFile, onViewContext }: { message: ConversationMessage; onOpenFile: (path: string, name: string) => void; onViewContext: (messageId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const canViewContext = message.kind === "agent_message" || message.kind === "proposal_message";

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!canViewContext) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [canViewContext]);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu]);

  switch (message.kind) {
    case "incoming_message":
      return (
        <div className="flex justify-end mb-3">
          <div className="message-card message-card-user">
            <div className="message-body message-body-inline">
              {renderInlineContent(message.content, { onOpenFile })}
            </div>
          </div>
        </div>
      );

    case "agent_message":
      return (
        <div className="flex justify-start mb-3" onContextMenu={handleContextMenu}>
          <div className="message-card">
            <div className="message-meta-row">
              <span className={agentTagClass(message.authoredBy)}>
                {message.authoredBy === "agent-a" ? "Agent A" : "Agent B"}
              </span>
            </div>
            <div className="message-body">{renderInlineContent(message.content, { onOpenFile })}</div>
          </div>
          {contextMenu && <ContextMenuPopup x={contextMenu.x} y={contextMenu.y} onAction={() => { setContextMenu(null); onViewContext(message.id); }} />}
        </div>
      );

    case "proposal_message": {
      const badge = proposalStatusBadge(message.status);
      return (
        <div className="mb-3" onContextMenu={handleContextMenu}>
          <div
            className="message-card message-card-interactive"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="message-meta-row">
              <span className={agentTagClass(message.authoredBy)}>
                {message.authoredBy === "agent-a" ? "Agent A" : "Agent B"}
              </span>
              <span className="message-label">propose</span>
              <span className="message-title truncate">{message.toolName}</span>
              <span className={badge.cls}>{badge.label}</span>
              <span className="message-chevron ml-auto">{expanded ? "▾" : "▸"}</span>
            </div>
            <div className="message-body-compact">{message.proposedStep}</div>
            {expanded && (
              <pre className="message-expand">
                {JSON.stringify(message.args, null, 2)}
              </pre>
            )}
          </div>
          {contextMenu && <ContextMenuPopup x={contextMenu.x} y={contextMenu.y} onAction={() => { setContextMenu(null); onViewContext(message.id); }} />}
        </div>
      );
    }

    case "vote_message":
      return (
        <div className="mb-3 pl-2">
          <div
            className="message-card message-card-muted message-card-compact message-card-interactive"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="message-meta-row">
              <span className={agentTagClass(message.authoredBy)}>
                {message.authoredBy === "agent-a" ? "Agent A" : "Agent B"}
              </span>
              <span className={message.approve ? "ui-badge ui-badge-status-success" : "ui-badge ui-badge-status-danger"}>
                {message.approve ? "Approve" : "Reject"}
              </span>
              <span className="message-chevron ml-auto">{expanded ? "▾" : "▸"}</span>
            </div>
            <div className={`message-body-compact ${expanded ? "" : "truncate"}`}>
              {expanded ? message.reason : message.reason.slice(0, 120) + (message.reason.length > 120 ? "..." : "")}
            </div>
          </div>
        </div>
      );

    case "tool_result_message":
      return (
        <div className="mb-3">
          <div
            className="message-card message-card-muted message-card-interactive"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="message-meta-row">
              <span className={message.success ? "ui-badge ui-badge-status-success" : "ui-badge ui-badge-status-danger"}>
                {message.success ? "Success" : "Failed"}
              </span>
              <span className="message-title">{message.toolName}</span>
              <span className="panel-meta">{(message.durationMs / 1000).toFixed(1)}s</span>
              <span className="message-chevron ml-auto">{expanded ? "▾" : "▸"}</span>
            </div>
            {expanded && (
              <pre className="message-expand max-h-60 overflow-y-auto">
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
            className="message-card message-card-interactive"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="message-meta-row">
              <span className="message-title">{message.childId}</span>
              <span className={deliveryModeBadgeClass(message.deliveryMode)}>
                {message.deliveryMode}
              </span>
              <span className="message-chevron ml-auto">{expanded ? "▾" : "▸"}</span>
            </div>
            {expanded ? (
              <div className="message-body">{renderInlineContent(message.content, { onOpenFile })}</div>
            ) : (
              <div className="message-body-compact truncate">{message.content}</div>
            )}
          </div>
        </div>
      );

    case "upward_message":
      return (
        <div className="mb-3">
          <div className="message-card">
            <div className="message-meta-row">
              <span className={deliveryModeBadgeClass(message.deliveryMode)}>{message.deliveryMode}</span>
            </div>
            <div className="message-body">{renderInlineContent(message.content, { onOpenFile })}</div>
          </div>
        </div>
      );

    case "system_message":
      return (
        <div className="flex justify-center mb-3">
          <span className="message-system-pill">{message.content}</span>
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

export function ChatPanel({ unitId, sessionInfo, messages, onSendMessage, onSelectUnit, onOpenFile, onViewContext, refs, onRemoveRef }: ChatPanelProps) {
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
    <div data-drop-zone="chat-input" className="flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="panel-header">
        {crumbs.map((crumb, i) => (
          <span key={crumb.unitId} className="flex items-center gap-2 text-sm min-w-0">
            {i > 0 && <span className="text-[var(--color-text-quaternary)]">›</span>}
            <span
              className={i === crumbs.length - 1 ? "breadcrumb-current truncate" : "breadcrumb-link truncate"}
              onClick={() => onSelectUnit(crumb.unitId)}
            >
              {crumb.label}
            </span>
          </span>
        ))}
        {unitId && sessionInfo && (
          <span className="ml-auto panel-meta">
            {sessionInfo.level} · {sessionInfo.state}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-[var(--color-canvas)]">
        {messages.length === 0 ? (
          <div className="text-center text-[var(--color-text-quaternary)] text-sm mt-8">No messages yet</div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} onOpenFile={onOpenFile} onViewContext={onViewContext} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {isL0 ? (
        <div className="composer-shell">
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
              className="composer-textarea"
              rows={2}
              placeholder={refs.length > 0 ? "Add a message (optional)..." : "Type your message..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div ref={dropdownRef} className="relative self-center flex">
              <button
                className="composer-button-primary rounded-r-none px-3 py-2.5 min-w-[5.75rem] disabled:cursor-not-allowed"
                onClick={handleSend}
                disabled={!input.trim() && refs.length === 0}
              >
                Send <span className="text-white/60 text-xs ml-0.5 inline-block w-[1.5em] text-center">{SEND_KEY_LABEL[sendKeyMode]}</span>
              </button>
              <button
                className={`composer-button-primary rounded-l-none border-l border-white/10 px-1.5 py-2.5 ${(!input.trim() && refs.length === 0) ? "opacity-50" : ""}`}
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                ▾
              </button>
              {dropdownOpen && (
                <div className="absolute bottom-full right-0 mb-2 min-w-[176px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[0_12px_24px_rgba(15,23,42,0.08),0_2px_6px_rgba(15,23,42,0.04)] z-10">
                  <button
                    className={`w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--color-surface-muted)] flex items-center justify-between ${sendKeyMode === "cmd-enter" ? "text-[var(--color-text)] font-medium" : "text-[var(--color-text-secondary)]"}`}
                    onClick={() => { setSendKeyMode("cmd-enter"); setDropdownOpen(false); }}
                  >
                    <span>⌘+Enter 发送</span>
                    {sendKeyMode === "cmd-enter" && <span className="text-xs text-[var(--color-text-quaternary)]">●</span>}
                  </button>
                  <button
                    className={`w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--color-surface-muted)] flex items-center justify-between ${sendKeyMode === "enter" ? "text-[var(--color-text)] font-medium" : "text-[var(--color-text-secondary)]"}`}
                    onClick={() => { setSendKeyMode("enter"); setDropdownOpen(false); }}
                  >
                    <span>Enter 发送</span>
                    {sendKeyMode === "enter" && <span className="text-xs text-[var(--color-text-quaternary)]">●</span>}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="child-conversation-hint">
          This is a child unit conversation view. Messages can only be sent from the L0 layer.
          Use the breadcrumb navigation to return to L0.
        </div>
      )}
    </div>
  );
}
