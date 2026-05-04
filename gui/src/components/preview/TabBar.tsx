// Elenchus GUI - Tab Bar Component
// Renders the tab navigation strip for the preview panel.
// Pure presentational — no content logic.

import type { PreviewTab, TabContent } from "./tab-types";

interface TabBarProps {
  tabs: PreviewTab[];
  activeKey: string;
  onSelectTab: (key: string) => void;
  onCloseTab: (key: string) => void;
  tabContents: Map<string, TabContent>;
  onToggleRender?: () => void;
}

export function TabBar({ tabs, activeKey, onSelectTab, onCloseTab, tabContents, onToggleRender }: TabBarProps) {
  const activeContent = activeKey ? tabContents.get(activeKey) : undefined;
  const isMarkdown = activeContent?.extension === ".md";

  return (
    <div className="preview-header">
      <div className="preview-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.key}
            className={`preview-tab whitespace-nowrap ${
              tab.key === activeKey ? "is-active" : ""
            }`}
            onClick={() => onSelectTab(tab.key)}
          >
            <span>{tab.title}</span>
            <button
              className="preview-tab-close"
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.key); }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {isMarkdown && activeContent && !activeContent.fileDeleted && (
        <div className="preview-controls">
          <button
            className="preview-toolbar-button px-3 py-2"
            onClick={onToggleRender}
          >
            {activeContent.renderAsMarkdown ? "Source" : "Render"}
          </button>
        </div>
      )}
    </div>
  );
}
