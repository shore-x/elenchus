// Elenchus GUI - Preview Panel Component
// Tabbed file viewer with Markdown rendering, raw view with line numbers,
// and drag-to-reference for adding line references to ChatPanel.
// Markdown mode uses AST position data for block-level line precision.
// Uses custom mouse-event-based drag (not HTML5 DnD) for reliable
// cross-panel drops and better cursor/hint feedback.

import React, { useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element } from "hast";
import type { FileReference } from "../../lib/types";
import { VirtualCodeViewer } from "./VirtualCodeViewer";
import { useDragToChat } from "../../hooks/useDragToChat";

// --- External link handler ---

async function openExternalUrl(url: string): Promise<void> {
  // In Electron renderer, window.open with _blank opens in the system browser
  window.open(url, "_blank", "noopener");
}

function isExternalUrl(href: string): boolean {
  try {
    return /^https?:\/\//i.test(href);
  } catch {
    return false;
  }
}

function ExternalAnchor({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: any }) {
  const handleClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    if (href && isExternalUrl(href)) {
      e.preventDefault();
      openExternalUrl(href);
    }
  }, [href]);

  return (
    <a href={href} onClick={handleClick} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

interface PreviewPanelProps {
  tabs: { path: string; name: string }[];
  activeTab: number;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  content: { content: string; extension: string; renderAsMarkdown: boolean; fileDeleted?: boolean } | null;
  onToggleRender: () => void;
  scrollToLine?: number;
  onAddRef?: (ref: FileReference) => void;
}

// --- Markdown component helpers ---

const LEAF_BLOCK_TYPES = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "pre", "li", "td", "th", "hr", "blockquote",
]);

function sourceLineProps(node: Element): Record<string, string> {
  const pos = node.position;
  if (!pos) return {};
  return {
    "data-source-line-start": String(pos.start.line),
    "data-source-line-end": String(pos.end.line),
  };
}

function buildMdComponents(): Record<string, React.ComponentType<any>> {
  const components: Record<string, React.ComponentType<any>> = {};

  for (const tag of LEAF_BLOCK_TYPES) {
    components[tag] = ({ node, children, ...rest }: any) => {
      const extra = sourceLineProps(node);
      return React.createElement(tag, { ...rest, ...extra }, children);
    };
  }

  components.code = ({ node, inline, className, children, ...rest }: any) => {
    if (inline) {
      return React.createElement("code", { className, ...rest }, children);
    }
    return React.createElement("code", { className, ...rest }, children);
  };

  components.a = ExternalAnchor;

  return components;
}

const MD_COMPONENTS = buildMdComponents();

// --- Markdown line range extraction ---

function getMdLineFromNode(node: Node): number | null {
  let el: HTMLElement | null = node.nodeType === Node.ELEMENT_NODE
    ? (node as HTMLElement)
    : (node.parentElement as HTMLElement);
  while (el) {
    const start = el.dataset.sourceLineStart;
    if (start) return parseInt(start, 10);
    el = el.parentElement;
  }
  return null;
}

function getMdLineRangeFromSelection(filePath: string): FileReference | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const startLine = getMdLineFromNode(range.startContainer);
  const endLine = getMdLineFromNode(range.endContainer);
  if (startLine === null || endLine === null) return null;
  return { path: filePath, startLine: Math.min(startLine, endLine), endLine: Math.max(startLine, endLine) };
}

// --- Component ---

export function PreviewPanel({ tabs, activeTab, onSelectTab, onCloseTab, content, onToggleRender, scrollToLine, onAddRef }: PreviewPanelProps) {
  const isMarkdown = content?.extension === ".md";
  const scrollRef = useRef<HTMLDivElement>(null);
  const activePath = tabs[activeTab]?.path ?? "";

  // Drag-to-chat for Markdown view
  const getMdLineRange = useCallback(() => getMdLineRangeFromSelection(activePath), [activePath]);
  const mdDrag = useDragToChat({ getLineRange: getMdLineRange, onAddRef });

  const lines = useMemo(() => {
    if (!content || content.renderAsMarkdown) return [];
    return content.content.split("\n");
  }, [content]);

  // Scroll to line
  useEffect(() => {
    if (!scrollToLine || !scrollRef.current) return;
    const target = scrollRef.current.querySelector<HTMLElement>(
      `[data-line="${scrollToLine}"], [data-source-line-start="${scrollToLine}"]`
    );
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [scrollToLine]);

  // Note: All mouse/selection event handling moved to VirtualCodeViewer

  return (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <div className="preview-header">
        <div className="preview-tabs">
          {tabs.map((tab, i) => (
            <div
              key={tab.path}
              className={`preview-tab whitespace-nowrap ${
                i === activeTab
                  ? "is-active"
                  : ""
              }`}
              onClick={() => onSelectTab(i)}
            >
              <span>{tab.name}</span>
              <button
                className="preview-tab-close"
                onClick={(e) => { e.stopPropagation(); onCloseTab(i); }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {isMarkdown && content && !content.fileDeleted && (
          <div className="preview-controls">
            <button
              className="preview-toolbar-button px-3 py-2"
              onClick={onToggleRender}
            >
              {content.renderAsMarkdown ? "Source" : "Render"}
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div
        ref={scrollRef}
        className="flex-1 relative overflow-y-auto"
      >
        {!content ? (
          <div className="preview-empty-state">
            Click a file in the workspace to preview
          </div>
        ) : content.fileDeleted ? (
          <div className="flex flex-col h-full">
            <div className="preview-warning-banner">
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor"><path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.446.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>
              <span>This file has been deleted or moved. The content below is the last known version.</span>
            </div>
            <div className="flex-1 preview-dimmed">
              {content.renderAsMarkdown ? (
                <div
                  className="markdown-body preview-content-body"
                  onMouseMove={mdDrag.handleMouseMove}
                  onMouseLeave={mdDrag.handleMouseLeave}
                  onMouseDown={mdDrag.handleMouseDown}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                    {content.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <VirtualCodeViewer
                  lines={lines}
                  filePath={activePath}
                  scrollToLine={scrollToLine}
                  onAddRef={onAddRef}
                />
              )}
            </div>
          </div>
        ) : content.renderAsMarkdown ? (
          <div
            className="markdown-body preview-content-body"
            onMouseMove={mdDrag.handleMouseMove}
            onMouseLeave={mdDrag.handleMouseLeave}
            onMouseDown={mdDrag.handleMouseDown}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
              {content.content}
            </ReactMarkdown>
          </div>
        ) : (
          <VirtualCodeViewer
            lines={lines}
            filePath={activePath}
            scrollToLine={scrollToLine}
            onAddRef={onAddRef}
          />
        )}

        {/* Cursor hint rendered by useDragToChat hook */}
      </div>
    </div>
  );
}
