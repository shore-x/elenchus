// Elenchus GUI - Workspace Directory Component
// Displays the workspace file tree with docs/all toggle and file open support.

import { useState } from "react";
import type { FsTreeNode } from "../../lib/types";

interface WorkspaceDirProps {
  tree: FsTreeNode[];
  mode: "docs" | "all";
  onModeChange: (mode: "docs" | "all") => void;
  onOpenFile: (path: string, name: string) => void;
  openFilePaths: string[];
  activeFilePath?: string;
}

function FileNode({ node, onOpenFile, openFilePaths, activeFilePath, depth }: {
  node: FsTreeNode;
  onOpenFile: (path: string, name: string) => void;
  openFilePaths: string[];
  activeFilePath?: string;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = node.path === activeFilePath;

  if (node.isDirectory) {
    return (
      <div>
        <div
          className="sidebar-row cursor-pointer text-sm"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="sidebar-disclosure">{expanded ? "▾" : "▸"}</span>
          <svg className="w-3.5 h-3.5 text-[var(--color-text-quaternary)] flex-shrink-0" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5V5.5A1.5 1.5 0 0 0 14.5 4H7.707L6.354 2.646A.5.5 0 0 0 6 2H1.5z"/></svg>
          <span className="truncate text-[13px] text-[var(--color-text-secondary)]">{node.name}</span>
        </div>
        {expanded && node.children?.map((child) => (
          <FileNode
            key={child.path}
            node={child}
            onOpenFile={onOpenFile}
            openFilePaths={openFilePaths}
            activeFilePath={activeFilePath}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`sidebar-row cursor-pointer text-sm ${
        isActive ? "is-active" : ""
      }`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={() => onOpenFile(node.path, node.name)}
    >
      <span className="w-4" />
      <span className="text-[var(--color-text-quaternary)] text-xs">·</span>
      <span className="truncate text-[13px]">{node.name}</span>
    </div>
  );
}

export function WorkspaceDir({ tree, mode, onModeChange, onOpenFile, openFilePaths, activeFilePath }: WorkspaceDirProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="sidebar-section-header">
        <span className="sidebar-section-title">Workspace</span>
        <div className="segmented-control">
          <button
            className={mode === "docs" ? "is-active" : ""}
            onClick={() => onModeChange("docs")}
          >
            Docs
          </button>
          <button
            className={mode === "all" ? "is-active" : ""}
            onClick={() => onModeChange("all")}
          >
            All
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {tree.length === 0 ? (
          <div className="px-4 py-3 text-sm text-[var(--color-text-quaternary)]">Empty workspace</div>
        ) : (
          tree.map((node) => (
            <FileNode
              key={node.path}
              node={node}
              onOpenFile={onOpenFile}
              openFilePaths={openFilePaths}
              activeFilePath={activeFilePath}
              depth={0}
            />
          ))
        )}
      </div>
    </div>
  );
}
