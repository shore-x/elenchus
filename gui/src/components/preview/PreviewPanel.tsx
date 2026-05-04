// Elenchus GUI - Preview Panel Component
//
// ## Keep-Alive Tab Orchestration
// This component is the orchestrator for the tab-based file viewer.
// All opened tabs are rendered simultaneously inside TabContentWrapper divs.
// Tab switching is achieved by toggling CSS visibility on the wrapper divs,
// NOT by mounting/unmounting content components.
//
// ## Architecture: Three-Layer Memo
// 1. TabContentWrapper (React.memo + custom comparison)
//    - Controls visibility via style prop (position:absolute, visibility, pointer-events)
//    - Custom memo: inactive tabs ignore scrollToLine changes
//    - On tab switch, only 2 wrappers re-render (old active → inactive, new active → active)
// 2. Inner content component (MarkdownTabContent / CodeTabContent)
//    - Wrapped in React.memo — props (content, onAddRef) are stable on tab switch
//    - NEVER receives isActive — visibility is wrapper's responsibility
//    - ReactMarkdown / VirtualCodeViewer are NOT re-invoked on tab switch
// 3. TabBar — lightweight, re-renders on activeKey change (acceptable)
//
// ## Pitfalls
// 1. NEVER add isActive to TabContentProps — it would force content re-render on switch.
// 2. NEVER pass inline callbacks to TabContentWrapper — they break its custom memo.
//    All callbacks (onAddRef, onToggleRender) must be stable references from App.
// 3. The custom memo comparison must be updated when new props are added to the wrapper.
//    Forgetting to compare a new prop will cause stale renders or missed updates.

import React from "react";
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

export function PreviewPanel({ tabs, activeKey, onSelectTab, onCloseTab, tabContents, scrollToLine, onAddRef }: PreviewPanelProps) {
  useRenderTime("PreviewPanel");

  return (
    <div className="flex flex-col h-full">
      <TabBar
        tabs={tabs}
        activeKey={activeKey}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
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
