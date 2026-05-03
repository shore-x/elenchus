// Elenchus GUI - Virtual Code Viewer
// High-performance virtual list with integrated selection and drag handling.
// Renders only visible rows instead of entire file.
// All mouse/selection events handled internally to avoid coordinate mismatches.

import React, { useRef, useEffect, useCallback, useMemo } from "react";
import type { FileReference } from "../../lib/types";
import { useDragToChat } from "../../hooks/useDragToChat";

interface VirtualCodeViewerProps {
  lines: string[];
  filePath: string;
  scrollToLine?: number;
  onAddRef?: (ref: FileReference) => void;
}

const LINE_HEIGHT = 21;
const BUFFER_LINES = 5;
const OVERSCAN = 3;

// Get line number from a DOM node by walking up the tree
function getLineNumberFromNode(node: Node): number | null {
  let el: HTMLElement | null = node.nodeType === Node.ELEMENT_NODE
    ? (node as HTMLElement)
    : (node.parentElement as HTMLElement);

  while (el) {
    const dataLine = el.dataset.line;
    if (dataLine) return parseInt(dataLine, 10);
    el = el.parentElement;
  }
  return null;
}

// Extract line range from current selection
function getLineRangeFromSelection(_lines: string[], filePath: string): FileReference | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

  const range = sel.getRangeAt(0);
  const startLine = getLineNumberFromNode(range.startContainer);
  const endLine = getLineNumberFromNode(range.endContainer);

  if (startLine === null || endLine === null) return null;
  return { path: filePath, startLine: Math.min(startLine, endLine), endLine: Math.max(startLine, endLine) };
}

export function VirtualCodeViewer({ lines, filePath, scrollToLine, onAddRef }: VirtualCodeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(0);

  const getLineRange = useCallback(() => getLineRangeFromSelection(lines, filePath), [lines, filePath]);
  const { handleMouseMove, handleMouseLeave, handleMouseDown } = useDragToChat({ getLineRange, onAddRef });

  const useVirtual = lines.length > 100;

  // Calculate visible range
  const visibleRange = useMemo(() => {
    if (!useVirtual) return { startIdx: 0, endIdx: lines.length - 1 };
    const startIdx = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - BUFFER_LINES - OVERSCAN);
    const endIdx = Math.min(
      lines.length - 1,
      Math.ceil((scrollTop + viewportHeight) / LINE_HEIGHT) + BUFFER_LINES + OVERSCAN
    );
    return { startIdx, endIdx };
  }, [scrollTop, viewportHeight, lines.length, useVirtual]);


  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Measure viewport height
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    observer.observe(containerRef.current);
    setViewportHeight(containerRef.current.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Scroll to specific line
  useEffect(() => {
    if (scrollToLine === undefined || !containerRef.current) return;
    const targetScroll = (scrollToLine - 1) * LINE_HEIGHT - viewportHeight / 2 + LINE_HEIGHT / 2;
    containerRef.current.scrollTop = Math.max(0, targetScroll);
  }, [scrollToLine, viewportHeight]);

  const { startIdx, endIdx } = visibleRange;

  // For native rendering, show all lines
  if (!useVirtual) {
    return (
      <div
        ref={containerRef}
        className="virtual-code-container native-scroll"
        onScroll={handleScroll}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
      >
        {lines.map((line, i) => {
          const lineNum = i + 1;
          return (
            <div
              key={lineNum}
              className="virtual-code-row"
              data-line={lineNum}
              style={{ height: LINE_HEIGHT }}
            >
              <div className="virtual-line-number">{lineNum}</div>
              <div className="virtual-code-line">{line || "\u00A0"}</div>
            </div>
          );
        })}
      </div>
    );
  }

  // Calculate padding for rows before and after visible range
  const topPadding = startIdx * LINE_HEIGHT;
  const bottomPadding = (lines.length - endIdx - 1) * LINE_HEIGHT;

  return (
    <div
      ref={containerRef}
      className="virtual-code-container"
      onScroll={handleScroll}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
    >
      {/* Top padding - creates scrollable space above visible rows */}
      {topPadding > 0 && <div style={{ height: topPadding }} />}

      {/* Visible rows - rendered in document flow */}
      {lines.slice(startIdx, endIdx + 1).map((line, i) => {
        const lineNum = startIdx + i + 1;
        return (
          <div
            key={lineNum}
            className="virtual-code-row"
            data-line={lineNum}
            style={{ height: LINE_HEIGHT }}
          >
            <div className="virtual-line-number">{lineNum}</div>
            <div className="virtual-code-line">{line || "\u00A0"}</div>
          </div>
        );
      })}

      {/* Bottom padding - creates scrollable space below visible rows */}
      {bottomPadding > 0 && <div style={{ height: bottomPadding }} />}
    </div>
  );
}
