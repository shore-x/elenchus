// Elenchus GUI - Event Stream Hook
// Listens to system events and fs-change events pushed from the Electron main process.
// Replaces the former useWebSocket hook that connected to the sidecar WebSocket server.

import { useEffect, useRef, useState } from "react";
import type { ServerEvent } from "../lib/types";

export function useEvents() {
  const [lastEvent, setLastEvent] = useState<ServerEvent | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const cleanup = window.electronAPI.onSystemEvent((event: ServerEvent) => {
      setLastEvent(event);
    });
    cleanupRef.current = cleanup;

    return () => {
      cleanup();
    };
  }, []);

  return { lastEvent };
}
