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
}

function FileNode({ node, onOpenFile, openFilePaths, depth }: {
  node: FsTreeNode;
  onOpenFile: (path: string, name: string) => void;
  openFilePaths: string[];
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isOpen = openFilePaths.includes(node.path);

  if (node.isDirectory) {
    return (
      <div>
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-gray-50 rounded text-sm text-gray-600"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-xs text-gray-400">{expanded ? "▾" : "▸"}</span>
          <span className="text-xs text-stone-400 font-medium">/</span>
          <span>{node.name}</span>
        </div>
        {expanded && node.children?.map((child) => (
          <FileNode
            key={child.path}
            node={child}
            onOpenFile={onOpenFile}
            openFilePaths={openFilePaths}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-stone-50 rounded text-sm ${
        isOpen ? "underline text-gray-800" : "text-gray-700"
      }`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={() => onOpenFile(node.path, node.name)}
    >
      <span className="w-4" />
      <span className="text-xs text-stone-400">—</span>
      <span className="truncate">{node.name}</span>
    </div>
  );
}

export function WorkspaceDir({ tree, mode, onModeChange, onOpenFile, openFilePaths }: WorkspaceDirProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-stone-100">
        <span className="font-semibold text-gray-600 text-xs uppercase tracking-wider">Workspace</span>
        <div className="flex rounded-md border border-stone-200 overflow-hidden text-xs">
          <button
            className={`px-2 py-0.5 ${mode === "docs" ? "bg-stone-100 text-gray-800" : "text-gray-500 hover:bg-stone-50"}`}
            onClick={() => onModeChange("docs")}
          >
            Docs
          </button>
          <button
            className={`px-2 py-0.5 ${mode === "all" ? "bg-stone-100 text-gray-800" : "text-gray-500 hover:bg-stone-50"}`}
            onClick={() => onModeChange("all")}
          >
            All
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {tree.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-400">Empty workspace</div>
        ) : (
          tree.map((node) => (
            <FileNode
              key={node.path}
              node={node}
              onOpenFile={onOpenFile}
              openFilePaths={openFilePaths}
              depth={0}
            />
          ))
        )}
      </div>
    </div>
  );
}
