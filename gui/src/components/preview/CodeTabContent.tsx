// Elenchus GUI - Code Tab Content
//
// Renders source code with VirtualCodeViewer and drag-to-reference.
// Supports toggle between rendered markdown (if applicable) and source view.
//
// ## Keep-Alive Contract
// This component is wrapped in React.memo and must NOT re-render on tab switch.
// It does NOT receive isActive — visibility is controlled by the wrapper div.
// VirtualCodeViewer uses virtualized rendering, so re-renders are cheap,
// but React.memo still prevents unnecessary line-splitting and hook re-runs.
//
// ## Pitfalls
// 1. NEVER add isActive as a prop — it would cause unnecessary re-render on switch.
// 2. NEVER add unstable callback props — they break React.memo.

import React, { useRef, useEffect, useMemo } from "react";
import type { TabContentProps } from "./tab-types";
import { VirtualCodeViewer } from "./VirtualCodeViewer";

export const CodeTabContent = React.memo(function CodeTabContent({ tabKey, content, scrollToLine, onAddRef }: TabContentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => {
    if (!content) return [];
    return content.content.split("\n");
  }, [content]);

  // Scroll to line
  useEffect(() => {
    if (!scrollToLine || !scrollRef.current) return;
    const target = scrollRef.current.querySelector<HTMLElement>(
      `[data-line="${scrollToLine}"]`
    );
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [scrollToLine]);

  if (!content) return null;

  return (
    <div
      ref={scrollRef}
      className="relative overflow-y-auto h-full"
    >
      {content.fileDeleted && (
        <div className="preview-warning-banner">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor"><path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.446.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>
          <span>This file has been deleted or moved. The content below is the last known version.</span>
        </div>
      )}
      <div className={content.fileDeleted ? "preview-dimmed" : ""}>
        <VirtualCodeViewer
          lines={lines}
          filePath={tabKey}
          scrollToLine={scrollToLine}
          onAddRef={onAddRef}
        />
      </div>
    </div>
  );
});
