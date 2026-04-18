// Elenchus GUI - Three Column Layout
// Resizable three-panel layout with drag handles and minimum width constraints.

import { useState, useRef, useCallback, type ReactNode } from "react";

const MIN_LEFT = 180;
const MIN_CENTER = 300;
const MIN_RIGHT = 200;
const DEFAULT_LEFT = 240;
const DEFAULT_RIGHT = 400;

export function ThreeColumnLayout({ children }: { children: [ReactNode, ReactNode, ReactNode] }) {
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"left" | "right" | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((handle: "left" | "right", e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = handle;
    startX.current = e.clientX;
    startWidth.current = handle === "left" ? leftWidth : rightWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.offsetWidth;
      const delta = ev.clientX - startX.current;

      if (dragging.current === "left") {
        const newLeft = Math.max(MIN_LEFT, Math.min(startWidth.current + delta, containerWidth - MIN_CENTER - rightWidth));
        setLeftWidth(newLeft);
      } else if (dragging.current === "right") {
        const newRight = Math.max(MIN_RIGHT, Math.min(startWidth.current - delta, containerWidth - MIN_CENTER - leftWidth));
        setRightWidth(newRight);
      }
    };

    const onMouseUp = () => {
      dragging.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [leftWidth, rightWidth]);

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      {/* Left Panel */}
      <div style={{ width: leftWidth, minWidth: MIN_LEFT }} className="flex-shrink-0 h-full overflow-hidden border-r border-gray-200 bg-white">
        {children[0]}
      </div>

      {/* Left Resize Handle */}
      <div
        className="w-1 flex-shrink-0 cursor-col-resize hover:bg-indigo-200 active:bg-indigo-300 transition-colors"
        onMouseDown={(e) => onMouseDown("left", e)}
      />

      {/* Center Panel */}
      <div className="flex-1 min-w-[300px] h-full overflow-hidden bg-[var(--color-bg)]">
        {children[1]}
      </div>

      {/* Right Resize Handle */}
      <div
        className="w-1 flex-shrink-0 cursor-col-resize hover:bg-indigo-200 active:bg-indigo-300 transition-colors"
        onMouseDown={(e) => onMouseDown("right", e)}
      />

      {/* Right Panel */}
      <div style={{ width: rightWidth, minWidth: MIN_RIGHT }} className="flex-shrink-0 h-full overflow-hidden border-l border-gray-200 bg-white">
        {children[2]}
      </div>
    </div>
  );
}
