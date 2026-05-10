// Elenchus GUI - Tab Context Menu Hook
// Provides right-click context menu logic for preview tab content.
// Each tab type provides its own getLineRange function; this hook handles
// the shared menu construction (Open in Finder, Reference in chat).

import { useState, useCallback } from "react";
import type { FileReference } from "../lib/types";
import type { ContextMenuItem } from "../components/shared/ContextMenu";

function isPointInSelection(x: number, y: number): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r && x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) {
      return true;
    }
  }
  return false;
}

export interface TabContextMenuOptions {
  filePath: string;
  getLineRange: () => FileReference | null;
  onAddRef?: (ref: FileReference) => void;
}

export function useTabContextMenu({ filePath, getLineRange, onAddRef }: TabContextMenuOptions) {
  const [menuState, setMenuState] = useState<{ x: number; y: number; ref: FileReference | null } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Determine the file reference based on selection context
    let ref: FileReference;
    if (isPointInSelection(e.clientX, e.clientY)) {
      const lineRef = getLineRange();
      if (lineRef) {
        ref = lineRef;
      } else {
        ref = { path: filePath, startLine: 1, endLine: 1 };
      }
    } else {
      // No selection or click outside selection — reference entire file
      ref = { path: filePath, startLine: 0, endLine: 0 };
    }

    setMenuState({ x: e.clientX, y: e.clientY, ref });
  }, [filePath, getLineRange]);

  const closeMenu = useCallback(() => {
    setMenuState(null);
  }, []);

  const menuItems: ContextMenuItem[] = menuState ? [
    {
      label: "Open in Finder",
      onClick: () => {
        window.electronAPI.showItemInFolder(filePath);
      },
    },
    {
      label: formatReferenceLabel(menuState.ref),
      onClick: () => {
        if (onAddRef && menuState.ref) {
          onAddRef(menuState.ref);
        }
      },
      disabled: !onAddRef,
    },
  ] : [];

  return {
    menuState,
    menuItems,
    handleContextMenu,
    closeMenu,
  };
}

function formatReferenceLabel(ref: FileReference | null): string {
  if (!ref) return "Reference file";
  if (ref.startLine === 0 && ref.endLine === 0) {
    return "Reference file";
  }
  if (ref.startLine === ref.endLine) {
    return `Reference line ${ref.startLine}`;
  }
  return `Reference lines ${ref.startLine}~${ref.endLine}`;
}
