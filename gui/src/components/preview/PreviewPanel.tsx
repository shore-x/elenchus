// Elenchus GUI - Preview Panel Component
// Orchestrator for the tab-based file viewer with Keep-Alive.
// Renders TabBar + all opened tab content components simultaneously,
// using CSS visibility on wrapper divs for instant tab switching.
// Tab content components never re-render on tab switch — only the
// lightweight wrapper divs change style props.

import React, { useCallback } from "react";
import type { FileReference } from "../../lib/types";
import type { PreviewTab, TabContent } from "./tab-types";
import { TabBar } from "./TabBar";
import { getTabComponent } from "./tab-registry";
import { useRenderTime } from "../../lib/debug-perf";

interface PreviewPanelProps {
  tabs: PreviewTab[];
  activeKey: string;
  onSelectTab: (key: string) => void;
  onCloseTab: (key: string) => void;
  tabContents: Map<string, TabContent>;
  onToggleRender: (key: string) => void;
  scrollToLine?: number;
  onAddRef?: (ref: FileReference) => void;
}

// Memoized tab content wrapper — only re-renders when its own props change.
// On tab switch, only the wrapper's style changes; the inner Component is skipped.
// Uses custom comparison to ignore scrollToLine for inactive tabs.
const TabContentWrapper = React.memo(function TabContentWrapper({
  tab,
  content,
  isActive,
  scrollToLine,
  onAddRef,
}: {
  tab: PreviewTab;
  content: TabContent | null;
  isActive: boolean;
  scrollToLine?: number;
  onAddRef?: (ref: FileReference) => void;
}) {
  const Component = getTabComponent(tab.type);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        visibility: isActive ? "visible" : "hidden",
        pointerEvents: isActive ? "auto" : "none",
      }}
    >
      <Component
        tabKey={tab.key}
        content={content}
        scrollToLine={isActive ? scrollToLine : undefined}
        onAddRef={onAddRef}
      />
    </div>
  );
}, (prev, next) => {
  // Custom comparison: scrollToLine only matters for active tabs
  if (prev.isActive && next.isActive) {
    return prev.tab.key === next.tab.key &&
           prev.content === next.content &&
           prev.scrollToLine === next.scrollToLine &&
           prev.onAddRef === next.onAddRef;
  }
  if (!prev.isActive && !next.isActive) {
    // Both inactive — ignore scrollToLine changes
    return prev.tab.key === next.tab.key &&
           prev.content === next.content &&
           prev.onAddRef === next.onAddRef;
  }
  // Active state changed — must re-render
  return false;
});

export function PreviewPanel({ tabs, activeKey, onSelectTab, onCloseTab, tabContents, onToggleRender, scrollToLine, onAddRef }: PreviewPanelProps) {
  useRenderTime("PreviewPanel");
  // Stable callback for TabBar — only calls onToggleRender for the active key
  const handleToggleRender = useCallback(() => {
    onToggleRender(activeKey);
  }, [onToggleRender, activeKey]);

  return (
    <div className="flex flex-col h-full">
      <TabBar
        tabs={tabs}
        activeKey={activeKey}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        tabContents={tabContents}
        onToggleRender={handleToggleRender}
      />

      {/* Keep-Alive content area: all tabs rendered, CSS controls visibility */}
      <div className="flex-1 min-h-0 relative">
        {tabs.length === 0 ? (
          <div className="preview-empty-state">
            Click a file in the workspace to preview
          </div>
        ) : (
          tabs.map((tab) => (
            <TabContentWrapper
              key={tab.key}
              tab={tab}
              content={tabContents.get(tab.key) ?? null}
              isActive={tab.key === activeKey}
              scrollToLine={scrollToLine}
              onAddRef={onAddRef}
            />
          ))
        )}
      </div>
    </div>
  );
}
