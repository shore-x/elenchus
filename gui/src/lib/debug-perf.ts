// Elenchus GUI - Debug Performance Utilities
// Add timing marks for tab switch performance analysis.
// View results in DevTools: Console tab for logs, Performance tab for marks.

let switchId = 0;

export function markTabSwitchStart(key: string) {
  switchId++;
  const id = `tab-switch-${switchId}`;
  performance.mark(`${id}-start`);
  console.time(`[perf] tab-switch → ${key}`);
  console.log(`[perf] 🔵 tab-switch START → ${key} (id=${id})`);
  return id;
}

export function markTabSwitchPhase(id: string, phase: string) {
  performance.mark(`${id}-${phase}`);
  try {
    performance.measure(`[perf] ${phase}`, `${id}-start`, `${id}-${phase}`);
  } catch { /* mark may not exist yet */ }
  console.log(`[perf]   ↳ ${phase} @ ${performance.now().toFixed(1)}ms`);
}

export function markTabSwitchEnd(id: string, key: string) {
  performance.mark(`${id}-end`);
  try {
    performance.measure(`[perf] TOTAL tab-switch → ${key}`, `${id}-start`, `${id}-end`);
  } catch { /* mark may not exist */ }
  console.timeEnd(`[perf] tab-switch → ${key}`);
}

// Hook to measure component render duration
import { useEffect, useRef } from "react";

export function useRenderTime(label: string) {
  const renderStart = useRef(performance.now());
  renderStart.current = performance.now();

  useEffect(() => {
    const duration = performance.now() - renderStart.current;
    if (duration > 1) {
      console.log(`[perf] ⏱ ${label} render+commit: ${duration.toFixed(1)}ms`);
    }
  });
}
