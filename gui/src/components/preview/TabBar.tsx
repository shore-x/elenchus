// Elenchus GUI - Tab Bar Component
// Renders the tab navigation strip for the preview panel.
// Pure presentational — no content logic.

import type { PreviewTab } from "./tab-types";

interface TabBarProps {
  tabs: PreviewTab[];
  activeKey: string;
  onSelectTab: (key: string) => void;
  onCloseTab: (key: string) => void;
}

export function TabBar({ tabs, activeKey, onSelectTab, onCloseTab }: TabBarProps) {
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
    </div>
  );
}
