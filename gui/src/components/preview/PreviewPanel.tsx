// Elenchus GUI - Preview Panel Component
// Tabbed file viewer with Markdown rendering and raw view toggle.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PreviewPanelProps {
  tabs: { path: string; name: string }[];
  activeTab: number;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  content: { content: string; extension: string; renderAsMarkdown: boolean } | null;
  onToggleRender: () => void;
}

export function PreviewPanel({ tabs, activeTab, onSelectTab, onCloseTab, content, onToggleRender }: PreviewPanelProps) {
  const isMarkdown = content?.extension === ".md";

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
      <div className="flex-1 overflow-y-auto">
        {!content ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            Double-click a file in the workspace to preview
          </div>
        ) : content.renderAsMarkdown ? (
          <div className="markdown-body p-6">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content.content}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className="p-4 text-sm font-mono text-gray-700 whitespace-pre-wrap break-words">
            {content.content}
          </pre>
        )}
      </div>
    </div>
  );
}
