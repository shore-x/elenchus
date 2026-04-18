// Elenchus GUI - WebSocket Hook
// Connects to the sidecar WebSocket event stream and provides the last received event.

import { useEffect, useRef, useState } from "react";
import type { ServerEvent } from "../lib/types";

export function useWebSocket(port: number | null) {
  const [lastEvent, setLastEvent] = useState<ServerEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!port) return;

    let disposed = false;

    function connect() {
      if (disposed) return;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/events`);
      wsRef.current = ws;

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as ServerEvent;
          setLastEvent(data);
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          reconnectTimerRef.current = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [port]);

  return { lastEvent };
}
