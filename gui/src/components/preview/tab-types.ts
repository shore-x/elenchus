// Elenchus GUI - Preview Tab Type Definitions
// Shared types for the tab-based preview system with Keep-Alive.
// Each tab type maps to a dedicated renderer component via tab-registry.

import type { FileReference } from "../../lib/types";

export type TabType = "markdown" | "code";

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
