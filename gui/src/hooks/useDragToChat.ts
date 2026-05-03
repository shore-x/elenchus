// Elenchus GUI - Drag-to-Chat Hook
// Shared drag-to-reference logic for code viewer and markdown preview.
// Handles hint display, drag initiation, drag chip, and drop onto chat input.

import { useRef, useEffect, useCallback } from "react";
import type { FileReference } from "../lib/types";

const DRAG_THRESHOLD = 4;

function pointInRect(x: number, y: number, rect: DOMRect, pad = 4): boolean {
  return x >= rect.left - pad && x <= rect.right + pad &&
         y >= rect.top - pad && y <= rect.bottom + pad;
}

function animateFlyIn(startX: number, startY: number, endEl: HTMLElement, label: string, onDone: () => void) {
  const endRect = endEl.getBoundingClientRect();
  const endX = endRect.left + endRect.width / 2;
  const endY = endRect.top + endRect.height / 2;

  const chip = document.createElement("span");
  chip.className = "ref-fly-chip";
  chip.textContent = label;
  chip.style.left = `${startX}px`;
  chip.style.top = `${startY}px`;
  document.body.appendChild(chip);

  chip.getBoundingClientRect();
  chip.style.left = `${endX}px`;
  chip.style.top = `${endY}px`;
  chip.style.transform = "translate(-50%, -50%) scale(0.9)";
  chip.style.opacity = "0.8";

  chip.addEventListener("transitionend", () => { chip.remove(); onDone(); }, { once: true });
  setTimeout(() => { if (chip.parentNode) { chip.remove(); onDone(); } }, 400);
}

// Check if (x, y) falls inside any client rect of the current selection
function isPointInSelection(x: number, y: number): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r && pointInRect(x, y, r, 2)) return true;
  }
  return false;
}

export interface DragToChatOptions {
  getLineRange: () => FileReference | null;
  onAddRef?: (ref: FileReference) => void;
}

export function useDragToChat({ getLineRange, onAddRef }: DragToChatOptions) {
  const hintElRef = useRef<HTMLElement | null>(null);

  const dragState = useRef<{
    active: boolean;
    ref: FileReference | null;
    startX: number;
    startY: number;
    chipEl: HTMLElement | null;
    started: boolean;
  }>({ active: false, ref: null, startX: 0, startY: 0, chipEl: null, started: false });

  // Selection change: only hide hint when selection is cleared (no React state)
  useEffect(() => {
    const onSelectionChange = () => {
      if (dragState.current.active) return;
      const sel = window.getSelection();
      if ((!sel || sel.isCollapsed || !sel.rangeCount) && hintElRef.current) {
        hintElRef.current.remove();
        hintElRef.current = null;
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // Hint: show on mouse move, hide on mouse leave
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragState.current.active) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      if (hintElRef.current) { hintElRef.current.remove(); hintElRef.current = null; }
      return;
    }
    if (!hintElRef.current) {
      const el = document.createElement("span");
      el.className = "ref-drag-hint";
      el.textContent = "drag to chat";
      document.body.appendChild(el);
      hintElRef.current = el;
    }
    hintElRef.current.style.left = `${e.clientX + 14}px`;
    hintElRef.current.style.top = `${e.clientY + 16}px`;
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hintElRef.current) { hintElRef.current.remove(); hintElRef.current = null; }
  }, []);

  // Mouse down: only preventDefault if click is inside selection (to preserve selection for drag)
  // Otherwise let browser handle it (e.g. deselect)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;

    // Check selection directly from DOM instead of cached state
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    // If click is NOT inside the current selection, let browser deselect normally
    if (!isPointInSelection(e.clientX, e.clientY)) return;

    e.preventDefault();

    const ref = getLineRange();
    if (!ref) return;

    dragState.current = {
      active: true, ref, startX: e.clientX, startY: e.clientY, chipEl: null, started: false,
    };

    if (hintElRef.current) { hintElRef.current.remove(); hintElRef.current = null; }
  }, [getLineRange, onAddRef]);

  // Document-level drag handlers
  useEffect(() => {
    const handleDocMouseMove = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds.active) return;

      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;

      if (!ds.started) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        ds.started = true;

        const chip = document.createElement("span");
        chip.className = "ref-drag-chip";
        const shortPath = ds.ref!.path.split("/").slice(-2).join("/");
        chip.textContent = `@${shortPath}:${ds.ref!.startLine}${ds.ref!.startLine !== ds.ref!.endLine ? `-${ds.ref!.endLine}` : ""}`;
        chip.style.left = `${e.clientX}px`;
        chip.style.top = `${e.clientY}px`;
        document.body.appendChild(chip);
        ds.chipEl = chip;
      }

      if (ds.chipEl) {
        ds.chipEl.style.left = `${e.clientX + 12}px`;
        ds.chipEl.style.top = `${e.clientY - 16}px`;
      }

      const dropZone = document.querySelector<HTMLElement>("[data-drop-zone='chat-input']");
      if (dropZone) {
        const rect = dropZone.getBoundingClientRect();
        if (pointInRect(e.clientX, e.clientY, rect, 0)) {
          dropZone.classList.add("drop-zone-active");
        } else {
          dropZone.classList.remove("drop-zone-active");
        }
      }
    };

    const handleDocMouseUp = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds.active) return;

      if (ds.chipEl) { ds.chipEl.remove(); ds.chipEl = null; }

      const dropZone = document.querySelector<HTMLElement>("[data-drop-zone='chat-input']");
      if (dropZone) dropZone.classList.remove("drop-zone-active");

      if (ds.started && ds.ref && dropZone) {
        const rect = dropZone.getBoundingClientRect();
        if (pointInRect(e.clientX, e.clientY, rect, 0)) {
          const chipsContainer = dropZone.querySelector<HTMLElement>("[data-ref-chips]");
          const shortPath = ds.ref.path.split("/").slice(-2).join("/");
          const label = `@${shortPath}:${ds.ref.startLine}${ds.ref.startLine !== ds.ref.endLine ? `-${ds.ref.endLine}` : ""}`;
          if (chipsContainer) {
            animateFlyIn(e.clientX, e.clientY, chipsContainer, label, () => { onAddRef?.(ds.ref!); });
          } else {
            onAddRef?.(ds.ref!);
          }
        }
      }

      dragState.current = { active: false, ref: null, startX: 0, startY: 0, chipEl: null, started: false };
    };

    document.addEventListener("mousemove", handleDocMouseMove);
    document.addEventListener("mouseup", handleDocMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleDocMouseMove);
      document.removeEventListener("mouseup", handleDocMouseUp);
    };
  }, [onAddRef]);

  return { handleMouseMove, handleMouseLeave, handleMouseDown };
}
