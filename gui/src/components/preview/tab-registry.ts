// Elenchus GUI - Tab Registry
// Maps TabType to its renderer component.
// To add a new tab type, create a component and register it here.

import type { TabType, TabContentProps } from "./tab-types";
import { MarkdownTabContent } from "./MarkdownTabContent";
import { CodeTabContent } from "./CodeTabContent";
import { HtmlTabContent } from "./HtmlTabContent";

const registry: Record<TabType, React.ComponentType<TabContentProps>> = {
  markdown: MarkdownTabContent,
  code: CodeTabContent,
  html: HtmlTabContent,
};

export function getTabComponent(type: TabType): React.ComponentType<TabContentProps> {
  return registry[type] ?? CodeTabContent;
}

export function inferTabType(extension: string): TabType {
  if (extension === ".md") return "markdown";
  if (extension === ".html") return "html";
  return "code";
}
