// Elenchus - WebSocket Event Broadcaster
// Broadcasts structured SystemEvent messages to all connected WebSocket clients.
// Also supports custom server-originated events (e.g. unit-tree-change) for
// GUI state synchronization that falls outside the core SystemEvent type.

import type { WebSocket as WsWebSocket } from "ws";
import type { SystemEvent } from "../../core/types.js";

export interface UnitTreeChangeEvent {
  type: "unit-tree-change";
}

export type ServerEvent = SystemEvent | UnitTreeChangeEvent;

const OPEN = 1; // ws.WebSocket.OPEN
const CONNECTING = 0; // ws.WebSocket.CONNECTING

export class WsBroadcaster {
  private readonly clients = new Set<WsWebSocket>();

  add(client: WsWebSocket): void {
    this.clients.add(client);
    client.on("close", () => {
      this.clients.delete(client);
    });
    client.on("error", () => {
      this.clients.delete(client);
    });
  }

  broadcast(event: ServerEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === OPEN) {
        client.send(data);
      }
    }
  }

  clientCount(): number {
    return this.clients.size;
  }

  closeAll(): void {
    for (const client of this.clients) {
      if (client.readyState === OPEN || client.readyState === CONNECTING) {
        client.close(1001, "Server shutting down");
      }
    }
    this.clients.clear();
  }
}
