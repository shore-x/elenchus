// Elenchus - REST API Handlers
// HTTP route handlers for the GUI sidecar server. These expose session state,
// message history, file system access, and pi-ai provider/model introspection
// to the Tauri WebView frontend.

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, extname, relative, basename } from "node:path";
import type { DeliberationSession } from "../../application/session.js";
import type { ConversationMessage, DeliberationUnitSnapshot, ToolLevel } from "../../core/types.js";

// --- Response types ---

export interface SessionInfoResponse {
  unitId: string;
  state: string;
  level: ToolLevel;
  tree: AgentTreeNode;
}

export interface AgentTreeNode {
  unitId: string;
  level: ToolLevel;
  path: number[];
  state: string;
  children: AgentTreeNode[];
}

export interface UnitInfoResponse {
  unitId: string;
  level: ToolLevel;
  path: number[];
  state: string;
  turnCounter: number;
  childCount: number;
  commitLog: { toolName: string; proposedStep: string; proposedBy: string; committedAt: number }[];
}

export interface MessagesResponse {
  messages: ConversationMessage[];
  hasMore: boolean;
}

export interface FsTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FsTreeNode[];
}

export interface ProviderInfo {
  id: string;
  name: string;
}

export interface ModelInfo {
  id: string;
  name: string;
}

// --- Helper: build agent tree from snapshot ---

function buildAgentTree(snapshot: DeliberationUnitSnapshot): AgentTreeNode {
  return {
    unitId: snapshot.unitId,
    level: snapshot.level,
    path: snapshot.path,
    state: snapshot.state,
    children: snapshot.children.map((child) => buildAgentTree(child.snapshot)),
  };
}

// --- Helper: parse URL search params ---

function getParam(url: URL, key: string): string | undefined {
  return url.searchParams.get(key) ?? undefined;
}

function getIntParam(url: URL, key: string, defaultValue: number): number {
  const raw = url.searchParams.get(key);
  if (raw === null) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

// --- Route handler type ---

export type ApiHandler = (
  method: string,
  url: URL,
  body: Record<string, unknown> | null,
  session: DeliberationSession,
) => Promise<{ status: number; body: unknown }>;

// --- Route table ---

const routes: { pattern: RegExp; handler: ApiHandler }[] = [];

function registerRoute(pattern: string, handler: ApiHandler): void {
  routes.push({ pattern: new RegExp(`^${pattern}$`), handler });
}

function matchRoute(pathname: string): ApiHandler | null {
  for (const route of routes) {
    if (route.pattern.test(pathname)) {
      return route.handler;
    }
  }
  return null;
}

// --- Session info ---

registerRoute("/api/session", async (_method, _url, _body, session) => {
  const snapshot = session.exportSnapshot();
  const tree = buildAgentTree(snapshot);
  return {
    status: 200,
    body: {
      unitId: snapshot.unitId,
      state: snapshot.state,
      level: snapshot.level,
      tree,
    } satisfies SessionInfoResponse,
  };
});

// --- Unit info ---

registerRoute("/api/units/([^/]+)", async (_method, url, _body, session) => {
  const unitId = decodeURIComponent(url.pathname.split("/").pop()!);
  const unit = session.getRootUnit().findUnitById(unitId);
  if (!unit) {
    return { status: 404, body: { error: `Unit ${unitId} not found` } };
  }
  const snapshot = unit.exportSnapshot();
  return {
    status: 200,
    body: {
      unitId: snapshot.unitId,
      level: snapshot.level,
      path: snapshot.path,
      state: snapshot.state,
      turnCounter: snapshot.turnCounter,
      childCount: snapshot.children.length,
      commitLog: snapshot.commitLog,
    } satisfies UnitInfoResponse,
  };
});

// --- Unit messages (paginated) ---

registerRoute("/api/units/([^/]+)/messages", async (_method, url, _body, session) => {
  const unitId = decodeURIComponent(url.pathname.split("/")[3]);
  const unit = session.getRootUnit().findUnitById(unitId);
  if (!unit) {
    return { status: 404, body: { error: `Unit ${unitId} not found` } };
  }

  const limit = getIntParam(url, "limit", 50);
  const before = getIntParam(url, "before", -1);
  const snapshot = unit.exportSnapshot();
  let messages = snapshot.ledger.messages;

  if (before >= 0) {
    messages = messages.filter((m) => {
      const seq = snapshot.ledger.sequenceStart + snapshot.ledger.messages.indexOf(m);
      return seq < before;
    });
  }

  const hasMore = messages.length > limit;
  const result = hasMore ? messages.slice(-limit) : messages;

  return {
    status: 200,
    body: {
      messages: result,
      hasMore,
    } satisfies MessagesResponse,
  };
});

// --- Send user message ---

registerRoute("/api/session/message", async (method, _url, body, session) => {
  if (method !== "POST") {
    return { status: 405, body: { error: "Method not allowed" } };
  }
  const content = body?.content as string | undefined;
  if (!content?.trim()) {
    return { status: 400, body: { error: "Message content is required" } };
  }
  session.sendUserMessage(content.trim());
  return { status: 200, body: { ok: true } };
});

// --- Terminate session ---

registerRoute("/api/session/terminate", async (method, _url, _body, session) => {
  if (method !== "POST") {
    return { status: 405, body: { error: "Method not allowed" } };
  }
  session.terminate();
  return { status: 200, body: { ok: true } };
});

// --- File system tree ---

registerRoute("/api/fs/tree", async (_method, url, _body, _session) => {
  const root = getParam(url, "root") ?? join(homedir(), "Elenchus");
  const mode = getParam(url, "mode") ?? "all";
  const tree = await buildFsTree(root, mode === "docs", 3);
  return { status: 200, body: tree };
});

async function buildFsTree(dirPath: string, docsOnly: boolean, maxDepth: number): Promise<FsTreeNode[]> {
  if (maxDepth <= 0) return [];

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FsTreeNode[] = [];
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".")) continue;

    const fullPath = join(dirPath, name);

    if (entry.isDirectory()) {
      const children = await buildFsTree(fullPath, docsOnly, maxDepth - 1);
      if (docsOnly && children.length === 0) continue;
      nodes.push({ name, path: fullPath, isDirectory: true, children });
    } else if (entry.isFile()) {
      if (docsOnly && extname(name).toLowerCase() !== ".md") continue;
      nodes.push({ name, path: fullPath, isDirectory: false });
    }
  }

  return nodes;
}

// --- Read file content ---

registerRoute("/api/fs/file", async (_method, url, _body, _session) => {
  const filePath = getParam(url, "path");
  if (!filePath) {
    return { status: 400, body: { error: "path parameter is required" } };
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const ext = extname(filePath).toLowerCase();
    return {
      status: 200,
      body: { path: filePath, content, extension: ext },
    };
  } catch {
    return { status: 404, body: { error: `File not found: ${filePath}` } };
  }
});

// --- Provider/model introspection (lazy-loaded pi-ai) ---

registerRoute("/api/config/providers", async (_method, _url, _body, _session) => {
  try {
    const { getProviders } = await import("@mariozechner/pi-ai");
    const providers = getProviders();
    return {
      status: 200,
      body: providers.map((id: string) => ({ id, name: id })),
    };
  } catch {
    return { status: 500, body: { error: "Failed to load providers from pi-ai" } };
  }
});

registerRoute("/api/config/models", async (_method, url, _body, _session) => {
  const provider = getParam(url, "provider");
  if (!provider) {
    return { status: 400, body: { error: "provider parameter is required" } };
  }

  try {
    const { getModels } = await import("@mariozechner/pi-ai");
    const models = getModels(provider as any);
    return {
      status: 200,
      body: models.map((m: any) => ({ id: m.id, name: m.name })),
    };
  } catch {
    return { status: 500, body: { error: `Failed to load models for provider: ${provider}` } };
  }
});

// --- Validate config (test LLM connection) ---

registerRoute("/api/config/validate", async (method, _url, body, _session) => {
  if (method !== "POST") {
    return { status: 405, body: { error: "Method not allowed" } };
  }

  const provider = body?.provider as string | undefined;
  const modelName = body?.modelName as string | undefined;
  const baseUrl = body?.baseUrl as string | undefined;

  if (!provider || !modelName) {
    return { status: 400, body: { error: "provider and modelName are required" } };
  }

  try {
    const { createPiAiLlmClient } = await import("../../adapters/llm/pi-ai-client.js");
    const client = createPiAiLlmClient({ provider, modelName, baseUrl });
    if (!client) {
      return { status: 400, body: { valid: false, error: `Could not create model: ${provider}/${modelName}` } };
    }
    return { status: 200, body: { valid: true } };
  } catch (err: any) {
    return { status: 400, body: { valid: false, error: err.message } };
  }
});

// --- Dispatcher ---

export async function handleApiRequest(
  method: string,
  url: URL,
  body: Record<string, unknown> | null,
  session: DeliberationSession,
): Promise<{ status: number; body: unknown }> {
  const handler = matchRoute(url.pathname);
  if (!handler) {
    return { status: 404, body: { error: `Not found: ${url.pathname}` } };
  }
  return handler(method, url, body, session);
}
