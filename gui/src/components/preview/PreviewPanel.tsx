// Elenchus GUI - Preview Panel Component
// Tabbed file viewer with Markdown rendering, raw view with line numbers,
// and selection-based file referencing for adding line references to ChatPanel.

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FileReference } from "../../lib/types";

interface PreviewPanelProps {
  tabs: { path: string; name: string }[];
  activeTab: number;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  content: { content: string; extension: string; renderAsMarkdown: boolean } | null;
  onToggleRender: () => void;
  scrollToLine?: number;
  onAddReference?: (ref: FileReference) => void;
}

function getLineRangeFromSelection(
  codeEl: HTMLElement | null,
  filePath: string
): FileReference | null {
  if (!codeEl) return null;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

  const range = sel.getRangeAt(0);
  const lineEls = codeEl.querySelectorAll<HTMLElement>("[data-line]");

  let startLine = Infinity;
  let endLine = -Infinity;

  for (const el of lineEls) {
    const lineNum = parseInt(el.dataset.line!, 10);
    if (range.intersectsNode(el)) {
      if (lineNum < startLine) startLine = lineNum;
      if (lineNum > endLine) endLine = lineNum;
    }
  }

  if (startLine === Infinity) return null;
  return { path: filePath, startLine, endLine };
}

export function PreviewPanel({ tabs, activeTab, onSelectTab, onCloseTab, content, onToggleRender, scrollToLine, onAddReference }: PreviewPanelProps) {
  const isMarkdown = content?.extension === ".md";
  const codeRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activePath = tabs[activeTab]?.path ?? "";
  const [selectionRef, setSelectionRef] = useState<FileReference | null>(null);
  const [buttonPos, setButtonPos] = useState<{ x: number; y: number } | null>(null);

  const lines = useMemo(() => {
    if (!content || content.renderAsMarkdown) return [];
    return content.content.split("\n");
  }, [content]);

  // Scroll to a specific line when scrollToLine changes
  useEffect(() => {
    if (!scrollToLine || !codeRef.current) return;
    const target = codeRef.current.querySelector<HTMLElement>(`[data-line="${scrollToLine}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [scrollToLine]);

  // Track text selection to show floating Reference button
  const handleSelectionChange = useCallback(() => {
    if (!codeRef.current || !scrollRef.current || !activePath) {
      setSelectionRef(null);
      setButtonPos(null);
      return;
    }

    const ref = getLineRangeFromSelection(codeRef.current, activePath);
    if (!ref) {
      setSelectionRef(null);
      setButtonPos(null);
      return;
    }

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const scrollRect = scrollRef.current.getBoundingClientRect();

    // Position button above the selection end, clamped inside the scroll container
    const x = Math.min(
      Math.max(rect.right - scrollRect.left + scrollRef.current.scrollLeft - 80, 4),
      scrollRef.current.clientWidth - 84
    );
    const y = rect.top - scrollRect.top + scrollRef.current.scrollTop - 28;

    setSelectionRef(ref);
    setButtonPos({ x, y });
  }, [activePath]);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [handleSelectionChange]);

  const handleAddRef = useCallback(() => {
    if (selectionRef && onAddReference) {
      onAddReference(selectionRef);
      // Clear selection after adding
      window.getSelection()?.removeAllRanges();
      setSelectionRef(null);
      setButtonPos(null);
    }
  }, [selectionRef, onAddReference]);

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
        {!content ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            Click a file in the workspace to preview
          </div>
        ) : content.renderAsMarkdown ? (
          <div className="markdown-body p-6">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content.content}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className="flex text-sm font-mono text-gray-700">
            <div className="line-numbers">
              {lines.map((_, i) => (
                <div key={i + 1}>{i + 1}</div>
              ))}
            </div>
            <div
              ref={codeRef}
              className="code-content whitespace-pre-wrap break-words"
            >
              {lines.map((line, i) => (
                <div key={i + 1} className="code-line" data-line={i + 1}>
                  {line}
                </div>
              ))}
            </div>
          </pre>
        )}

        {/* Floating Reference button */}
        {selectionRef && buttonPos && onAddReference && (
          <button
            className="absolute ref-float-btn"
            style={{ left: buttonPos.x, top: buttonPos.y }}
            onClick={handleAddRef}
          >
            ↗ Reference
          </button>
        )}
      </div>
    </div>
  );
}
