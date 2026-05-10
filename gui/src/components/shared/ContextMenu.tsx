// Elenchus GUI - Shared Context Menu Component
// Generic right-click context menu with consistent styling.
// Menu items are defined by the caller — this component only handles rendering and dismissal.

import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Use setTimeout to avoid the opening click from immediately closing
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKeyDown);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Adjust position if menu would overflow viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 32 - 16);

  return (
    <div
      ref={menuRef}
      className="overlay-menu"
      style={{ left: adjustedX, top: adjustedY }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          className="overlay-menu-item"
          disabled={item.disabled}
          onClick={() => { item.onClick(); onClose(); }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
