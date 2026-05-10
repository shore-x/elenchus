// Elenchus GUI - Preview Tab Type Definitions
//
// ## Design Rationale
// TabContentProps intentionally does NOT include isActive.
// Visibility is controlled by the wrapper div in PreviewPanel (CSS visibility/pointer-events).
// This separation ensures content components never re-render on tab switch.
//
// ## Pitfalls
// 1. NEVER add isActive to TabContentProps — it would break the keep-alive memo chain.
//    If a content component needs to know if it's active, the wrapper should handle it
//    (e.g. scrollToLine is only passed when active).
// 2. NEVER add callback props that change on every render (inline arrows).
//    All callbacks in TabContentProps must be stable references from App (useCallback).

import type { FileReference } from "../../lib/types";

export type TabType = "markdown" | "code" | "html";

export interface PreviewTab {
  key: string;   // Unique identifier (file path)
  title: string; // Display name
  type: TabType; // Determines which renderer component to use
}

export interface TabContent {
  content: string;
  extension: string;
  fileDeleted?: boolean;
  renderAsMarkdown?: boolean; // code tab: toggle between rendered/source
}

export interface TabContentProps {
  tabKey: string;
  content: TabContent | null;
  scrollToLine?: number;
  onAddRef?: (ref: FileReference) => void;
}
