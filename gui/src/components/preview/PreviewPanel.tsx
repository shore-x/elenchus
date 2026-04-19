// Elenchus GUI - Preview Panel Component
// Tabbed file viewer with Markdown rendering, raw view with line numbers,
// and drag-to-reference for adding line references to ChatPanel.
// Markdown mode uses AST position data for block-level line precision.
// Uses custom mouse-event-based drag (not HTML5 DnD) for reliable
// cross-panel drops and better cursor/hint feedback.

import React, { useRef, useEffect, useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element } from "hast";
import type { FileReference } from "../../lib/types";

// --- External link handler ---

async function openExternalUrl(url: string): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    // Fallback for browser dev mode or if Tauri shell is unavailable
    window.open(url, "_blank", "noopener");
  }
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
  content: { content: string; extension: string; renderAsMarkdown: boolean } | null;
  onToggleRender: () => void;
  scrollToLine?: number;
  onAddRef?: (ref: FileReference) => void;
}

// --- Line range extraction ---

function getLineRangeFromSelection(
  container: HTMLElement,
  filePath: string
): FileReference | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

  const range = sel.getRangeAt(0);

  const lineEls = container.querySelectorAll<HTMLElement>("[data-line]");
  const blockEls = container.querySelectorAll<HTMLElement>("[data-source-line-start]");

  let startLine = Infinity;
  let endLine = -Infinity;

  for (const el of lineEls) {
    const lineNum = parseInt(el.dataset.line!, 10);
    if (range.intersectsNode(el)) {
      if (lineNum < startLine) startLine = lineNum;
      if (lineNum > endLine) endLine = lineNum;
    }
  }

  for (const el of blockEls) {
    if (range.intersectsNode(el)) {
      const s = parseInt(el.dataset.sourceLineStart!, 10);
      const e = parseInt(el.dataset.sourceLineEnd!, 10);
      if (s < startLine) startLine = s;
      if (e > endLine) endLine = e;
    }
  }

  if (startLine === Infinity) return null;
  return { path: filePath, startLine, endLine };
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

// --- Utility ---

function formatLineRange(startLine: number, endLine: number): string {
  return startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
}

function formatRefLabel(ref: FileReference): string {
  const segs = ref.path.split("/").filter(Boolean);
  const short = segs.length <= 2 ? segs.join("/") : segs.slice(-2).join("/");
  return `@${short}:${formatLineRange(ref.startLine, ref.endLine)}`;
}

// Check if a point (clientX, clientY) is within a DOMRect (with padding)
function pointInRect(x: number, y: number, rect: DOMRect, pad = 4): boolean {
  return x >= rect.left - pad && x <= rect.right + pad &&
         y >= rect.top - pad && y <= rect.bottom + pad;
}

// --- Fly-in animation ---

function animateFlyIn(startX: number, startY: number, endEl: HTMLElement, label: string, onDone: () => void) {
  const endRect = endEl.getBoundingClientRect();
  const endX = endRect.left + endRect.width / 2;
  const endY = endRect.top + endRect.height / 2;

  const chip = document.createElement("span");
  chip.className = "ref-fly-chip";
  chip.textContent = label;
  chip.style.left = `${startX}px`;
  chip.style.top = `${startY}px`;
  document.body.appendChild(chip);

  chip.getBoundingClientRect();
  chip.style.left = `${endX}px`;
  chip.style.top = `${endY}px`;
  chip.style.transform = "translate(-50%, -50%) scale(0.9)";
  chip.style.opacity = "0.8";

  chip.addEventListener("transitionend", () => {
    chip.remove();
    onDone();
  }, { once: true });

  setTimeout(() => {
    if (chip.parentNode) {
      chip.remove();
      onDone();
    }
  }, 400);
}

// --- Component ---

const DRAG_THRESHOLD = 4; // px before starting drag after mousedown

export function PreviewPanel({ tabs, activeTab, onSelectTab, onCloseTab, content, onToggleRender, scrollToLine, onAddRef }: PreviewPanelProps) {
  const isMarkdown = content?.extension === ".md";
  const scrollRef = useRef<HTMLDivElement>(null);
  const activePath = tabs[activeTab]?.path ?? "";

  // Selection state
  const [selectionRef, setSelectionRef] = useState<FileReference | null>(null);
  // Cursor hint: shown near mouse when hovering over selected area
  const [cursorHint, setCursorHint] = useState<{ x: number; y: number } | null>(null);

  // Custom drag state (not React state — mutated in event handlers for perf)
  const dragState = useRef<{
    active: boolean;
    ref: FileReference | null;
    startX: number;
    startY: number;
    chipEl: HTMLElement | null;
    started: boolean; // true once mouse moved past threshold
  }>({ active: false, ref: null, startX: 0, startY: 0, chipEl: null, started: false });

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

  // --- Selection tracking ---
  const handleSelectionChange = useCallback(() => {
    if (!scrollRef.current || !activePath) {
      setSelectionRef(null);
      setCursorHint(null);
      return;
    }
    if (dragState.current.active) return; // Don't update during drag

    const ref = getLineRangeFromSelection(scrollRef.current, activePath);
    setSelectionRef(ref);
    if (!ref) setCursorHint(null);
  }, [activePath]);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [handleSelectionChange]);

  // --- Mouse move: detect hover over selection + update cursor hint ---
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragState.current.active) return; // Handled by document-level listener

    if (!selectionRef || !scrollRef.current) {
      setCursorHint(null);
      return;
    }

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      setCursorHint(null);
      return;
    }

    const range = sel.getRangeAt(0);
    const selRect = range.getBoundingClientRect();

    if (pointInRect(e.clientX, e.clientY, selRect)) {
      // Show hint at cursor bottom-right
      const scrollRect = scrollRef.current.getBoundingClientRect();
      const relX = e.clientX - scrollRect.left + scrollRef.current.scrollLeft + 14;
      const relY = e.clientY - scrollRect.top + scrollRef.current.scrollTop + 16;
      setCursorHint({ x: relX, y: relY });
    } else {
      setCursorHint(null);
    }
  }, [selectionRef]);

  const handleMouseLeave = useCallback(() => {
    if (!dragState.current.active) {
      setCursorHint(null);
    }
  }, []);

  // --- Custom drag: mousedown on selected area ---
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!selectionRef || !scrollRef.current || e.button !== 0) return;

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const selRect = range.getBoundingClientRect();

    // Only start drag if mousedown is within the selection area
    if (!pointInRect(e.clientX, e.clientY, selRect)) return;

    e.preventDefault(); // Prevent text deselection and text cursor

    dragState.current = {
      active: true,
      ref: selectionRef,
      startX: e.clientX,
      startY: e.clientY,
      chipEl: null,
      started: false,
    };

    // Hide cursor hint immediately
    setCursorHint(null);
  }, [selectionRef]);

  // --- Document-level mousemove/mouseup for drag lifecycle ---
  useEffect(() => {
    const handleDocMouseMove = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds.active) return;

      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;

      // Start drag visual after threshold
      if (!ds.started) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        ds.started = true;

        // Create floating chip
        const chip = document.createElement("span");
        chip.className = "ref-drag-chip";
        chip.textContent = formatRefLabel(ds.ref!);
        chip.style.left = `${e.clientX}px`;
        chip.style.top = `${e.clientY}px`;
        document.body.appendChild(chip);
        ds.chipEl = chip;
      }

      // Move chip with cursor
      if (ds.chipEl) {
        ds.chipEl.style.left = `${e.clientX + 12}px`;
        ds.chipEl.style.top = `${e.clientY - 16}px`;
      }

      // Highlight drop zone if cursor is over it
      const dropZone = document.querySelector<HTMLElement>("[data-drop-zone='chat-input']");
      if (dropZone) {
        const rect = dropZone.getBoundingClientRect();
        if (pointInRect(e.clientX, e.clientY, rect, 0)) {
          dropZone.classList.add("drop-zone-active");
        } else {
          dropZone.classList.remove("drop-zone-active");
        }
      }
    };

    const handleDocMouseUp = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds.active) return;

      // Clean up chip
      if (ds.chipEl) {
        ds.chipEl.remove();
        ds.chipEl = null;
      }

      // Clean up drop zone highlight
      const dropZone = document.querySelector<HTMLElement>("[data-drop-zone='chat-input']");
      if (dropZone) {
        dropZone.classList.remove("drop-zone-active");
      }

      // If drag was started (past threshold), check for drop
      if (ds.started && ds.ref && dropZone) {
        const rect = dropZone.getBoundingClientRect();
        if (pointInRect(e.clientX, e.clientY, rect, 0)) {
          // Successful drop — animate fly-in then add ref
          const chipsContainer = dropZone.querySelector<HTMLElement>("[data-ref-chips]");
          if (chipsContainer) {
            animateFlyIn(e.clientX, e.clientY, chipsContainer, formatRefLabel(ds.ref), () => {
              onAddRef?.(ds.ref!);
            });
          } else {
            onAddRef?.(ds.ref!);
          }
        }
      }

      // Reset drag state
      dragState.current = { active: false, ref: null, startX: 0, startY: 0, chipEl: null, started: false };
    };

    document.addEventListener("mousemove", handleDocMouseMove);
    document.addEventListener("mouseup", handleDocMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleDocMouseMove);
      document.removeEventListener("mouseup", handleDocMouseUp);
    };
  }, [onAddRef]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <div className="flex items-center border-b border-stone-200 bg-stone-50 min-h-[32px]">
        <div className="flex flex-1 overflow-x-auto">
          {tabs.map((tab, i) => (
            <div
              key={tab.path}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-stone-200 whitespace-nowrap ${
                i === activeTab
                  ? "bg-white text-gray-800 font-medium border-b-2 border-b-stone-400"
                  : "text-gray-500 hover:text-gray-700 hover:bg-stone-100"
              }`}
              onClick={() => onSelectTab(i)}
            >
              <span>{tab.name}</span>
              <button
                className="ml-1 text-stone-300 hover:text-stone-500"
                onClick={(e) => { e.stopPropagation(); onCloseTab(i); }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {isMarkdown && content && (
          <button
            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 border-l border-stone-200"
            onClick={onToggleRender}
          >
            {content.renderAsMarkdown ? "Source" : "Render"}
          </button>
        )}
      </div>

      {/* Content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto relative"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
      >
        {!content ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            Click a file in the workspace to preview
          </div>
        ) : content.renderAsMarkdown ? (
          <div className="markdown-body p-6">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
              {content.content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="code-table text-sm font-mono text-gray-700">
            {lines.map((line, i) => (
              <div key={i + 1} className="code-row">
                <div className="line-number">{i + 1}</div>
                <div className="code-line" data-line={i + 1}>
                  {line}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Cursor hint near mouse when hovering over selection */}
        {selectionRef && cursorHint && !dragState.current.active && (
          <span
            className="ref-drag-hint"
            style={{ left: cursorHint.x, top: cursorHint.y }}
          >
            drag to chat
          </span>
        )}
      </div>
    </div>
  );
}
