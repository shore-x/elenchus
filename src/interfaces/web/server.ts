// Elenchus - Sidecar HTTP + WebSocket Server
// Serves the REST API and WebSocket event stream for the Tauri WebView frontend.
// The server binds to localhost on a random available port and writes the port
// to stdout so the Tauri shell can discover it.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import type { DeliberationSession } from "../../application/session.js";
import type { SystemEvent } from "../../core/types.js";
import { handleApiRequest } from "./api-handlers.js";
import { WsBroadcaster, type ServerEvent } from "./ws-broadcaster.js";
import { FsWatcher, type FsChange } from "./fs-watcher.js";

export interface SidecarServerOptions {
  session: DeliberationSession;
  workspaceRoot: string;
}

export class SidecarServer {
  private readonly httpServer: Server;
  private readonly wss: WebSocketServer;
  private readonly broadcaster: WsBroadcaster;
  private readonly session: DeliberationSession;
  private readonly fsWatcher: FsWatcher;
  private port: number = 0;

  constructor(options: SidecarServerOptions) {
    this.session = options.session;
    this.broadcaster = new WsBroadcaster();
    this.fsWatcher = new FsWatcher(options.workspaceRoot, (changes) => {
      this.broadcaster.broadcast({ type: "fs-change", changes });
    });

    // HTTP server
    this.httpServer = createServer(async (req, res) => {
      await this.handleHttpRequest(req, res);
    });

    // WebSocket server on the same HTTP server
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws: WsWebSocket) => {
      this.broadcaster.add(ws);
    });
  }

  getPort(): number {
    return this.port;
  }

  start(): Promise<number> {
    this.fsWatcher.start();
    return new Promise((resolve, reject) => {
      this.httpServer.listen(0, "127.0.0.1", () => {
        const addr = this.httpServer.address();
        if (typeof addr === "object" && addr !== null) {
          this.port = addr.port;
          resolve(this.port);
        } else {
          reject(new Error("Failed to bind sidecar server"));
        }
      });
      this.httpServer.on("error", reject);
    });
  }

  close(): void {
    this.fsWatcher.close();
    this.broadcaster.closeAll();
    this.wss.close();
    this.httpServer.close();
  }

  getSystemEventHandler(): (event: SystemEvent) => void {
    return (event: SystemEvent) => {
      this.broadcaster.broadcast(event);

      // Broadcast unit-tree-change for events that modify the agent tree
      if (
        event.type === "child-spawned" ||
        event.type === "state-transition" ||
        event.type === "upward-message"
      ) {
        this.broadcaster.broadcast({ type: "unit-tree-change" });
      }
    };
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    const method = req.method ?? "GET";

    // CORS headers for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse request body for POST
    let body: Record<string, unknown> | null = null;
    if (method === "POST" && req.headers["content-type"]?.includes("application/json")) {
      body = await this.readJsonBody(req);
    }

    try {
      const result = await handleApiRequest(method, url, body, this.session);
      process.stderr.write(`[http] ${method} ${url.pathname} → ${result.status}\n`);
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.body));
    } catch (err: any) {
      process.stderr.write(`[http] ${method} ${url.pathname} → 500 ${err.message}\n`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message ?? "Internal server error" }));
    }
  }

  private readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        if (chunks.length === 0) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
        } catch {
          resolve(null);
        }
      });
      req.on("error", () => resolve(null));
    });
  }
}
