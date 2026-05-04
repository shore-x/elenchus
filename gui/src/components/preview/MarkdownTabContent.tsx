// Elenchus GUI - Markdown Tab Content
//
// Renders Markdown content with ReactMarkdown, drag-to-reference,
// and AST-based line position data for block-level precision.
// Internally manages Source/Render toggle — no external coupling.
//
// ## Keep-Alive Contract
// This component is wrapped in React.memo and must NOT re-render on tab switch.
// It does NOT receive isActive — visibility is controlled by the wrapper div.
// React.memo ensures ReactMarkdown is only re-invoked when content actually changes.
//
// ## Self-Contained Toggle
// The Source/Render toggle button is fully internal to this component.
// renderAsMarkdown is managed as local state, initialized from content.renderAsMarkdown.
// The toggle does NOT propagate to parent — it's a pure view preference.
//
// ## Pitfalls
// 1. NEVER add isActive as a prop — it would cause ReactMarkdown to re-diff on every switch.
// 2. NEVER add unstable callback props — they break React.memo.
// 3. ReactMarkdown parsing is synchronous and expensive for large files.
//    If performance becomes an issue, consider useDeferredValue or web workers.

import React, { useRef, useEffect, useCallback, useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element } from "hast";
import type { TabContentProps } from "./tab-types";
import { useDragToChat } from "../../hooks/useDragToChat";
import { VirtualCodeViewer } from "./VirtualCodeViewer";

// --- External link handler ---

async function openExternalUrl(url: string): Promise<void> {
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
const REMARK_PLUGINS = [remarkGfm];

// --- Markdown line range extraction for drag-to-reference ---

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

function getMdLineRangeFromSelection(filePath: string) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const startLine = getMdLineFromNode(range.startContainer);
  const endLine = getMdLineFromNode(range.endContainer);
  if (startLine === null || endLine === null) return null;
  return { path: filePath, startLine: Math.min(startLine, endLine), endLine: Math.max(startLine, endLine) };
}

// --- Component ---

export const MarkdownTabContent = React.memo(function MarkdownTabContent({ tabKey, content, scrollToLine, onAddRef }: TabContentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [renderAsMarkdown, setRenderAsMarkdown] = useState(true);

  const lines = useMemo(() => {
    if (!content) return [];
    return content.content.split("\n");
  }, [content]);

  const getMdLineRange = useCallback(() => getMdLineRangeFromSelection(tabKey), [tabKey]);
  const mdDrag = useDragToChat({ getLineRange: getMdLineRange, onAddRef });

  // Scroll to line
  useEffect(() => {
    if (!scrollToLine || !scrollRef.current) return;
    if (renderAsMarkdown) {
      const target = scrollRef.current.querySelector<HTMLElement>(
        `[data-source-line-start="${scrollToLine}"]`
      );
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [scrollToLine, renderAsMarkdown]);

  if (!content) return null;

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto h-full"
    >
      {content.extension === ".md" && !content.fileDeleted && (
        <button
          className="preview-toolbar-button absolute top-2 right-2 z-10 px-3 py-1.5 shadow-sm"
          onClick={() => setRenderAsMarkdown(prev => !prev)}
        >
          {renderAsMarkdown ? "Source" : "Render"}
        </button>
      )}
      {content.fileDeleted && (
        <div className="preview-warning-banner">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor"><path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.446.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>
          <span>This file has been deleted or moved. The content below is the last known version.</span>
        </div>
      )}
      {renderAsMarkdown ? (
        <div
          className={`markdown-body preview-content-body${content.fileDeleted ? " preview-dimmed" : ""}`}
          onMouseMove={mdDrag.handleMouseMove}
          onMouseLeave={mdDrag.handleMouseLeave}
          onMouseDown={mdDrag.handleMouseDown}
        >
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
            {content.content}
          </ReactMarkdown>
        </div>
      ) : (
        <div className={content.fileDeleted ? "preview-dimmed" : ""}>
          <VirtualCodeViewer
            lines={lines}
            filePath={tabKey}
            scrollToLine={scrollToLine}
            onAddRef={onAddRef}
          />
        </div>
      )}
    </div>
  );
});
