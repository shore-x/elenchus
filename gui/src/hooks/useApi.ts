// Elenchus GUI - API Hook
// Provides typed REST API access to the sidecar server.

import { useCallback } from "react";
import type { SessionInfo, UnitInfo, ConversationMessage, FsTreeNode, FileContent, ProviderInfo, ModelInfo } from "../lib/types";

export function useApi(port: number | null) {
  const baseUrl = port ? `http://127.0.0.1:${port}` : "";

  const request = useCallback(async <T>(path: string, options?: RequestInit): Promise<T | null> => {
    if (!port) return null;
    try {
      const res = await fetch(`${baseUrl}${path}`, options);
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch {
      return null;
    }
  }, [port, baseUrl]);

  const getSessionInfo = useCallback(async (): Promise<SessionInfo | null> => {
    return request<SessionInfo>("/api/session");
  }, [request]);

  const getUnitInfo = useCallback(async (unitId: string): Promise<UnitInfo | null> => {
    return request<UnitInfo>(`/api/units/${encodeURIComponent(unitId)}`);
  }, [request]);

  const getUnitMessages = useCallback(async (unitId: string, before?: number, limit?: number): Promise<ConversationMessage[]> => {
    const params = new URLSearchParams();
    if (before !== undefined) params.set("before", String(before));
    if (limit !== undefined) params.set("limit", String(limit));
    const qs = params.toString();
    const result = await request<{ messages: ConversationMessage[]; hasMore: boolean }>(
      `/api/units/${encodeURIComponent(unitId)}/messages${qs ? `?${qs}` : ""}`
    );
    return result?.messages ?? [];
  }, [request]);

  const sendMessage = useCallback(async (content: string): Promise<boolean> => {
    if (!port) return false;
    try {
      const res = await fetch(`${baseUrl}/api/session/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [port, baseUrl]);

  const terminateSession = useCallback(async (): Promise<boolean> => {
    if (!port) return false;
    try {
      const res = await fetch(`${baseUrl}/api/session/terminate`, { method: "POST" });
      return res.ok;
    } catch {
      return false;
    }
  }, [port, baseUrl]);

  const getFsTree = useCallback(async (mode: "docs" | "all"): Promise<FsTreeNode[]> => {
    const result = await request<FsTreeNode[]>(`/api/fs/tree?mode=${mode}`);
    return result ?? [];
  }, [request]);

  const readFile = useCallback(async (path: string): Promise<FileContent | null> => {
    return request<FileContent>(`/api/fs/file?path=${encodeURIComponent(path)}`);
  }, [request]);

  const getProviders = useCallback(async (): Promise<ProviderInfo[]> => {
    const result = await request<ProviderInfo[]>("/api/config/providers");
    return result ?? [];
  }, [request]);

  const getModels = useCallback(async (provider: string): Promise<ModelInfo[]> => {
    const result = await request<ModelInfo[]>(`/api/config/models?provider=${encodeURIComponent(provider)}`);
    return result ?? [];
  }, [request]);

  const validateConfig = useCallback(async (config: { provider: string; modelName: string; baseUrl?: string }): Promise<{ valid: boolean; error?: string }> => {
    if (!port) return { valid: false, error: "No sidecar connection" };
    try {
      const res = await fetch(`${baseUrl}/api/config/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const result = await res.json() as { valid: boolean; error?: string };
      return result;
    } catch {
      return { valid: false, error: "Connection failed" };
    }
  }, [port, baseUrl]);

  return {
    getSessionInfo,
    getUnitInfo,
    getUnitMessages,
    sendMessage,
    terminateSession,
    getFsTree,
    readFile,
    getProviders,
    getModels,
    validateConfig,
  };
}
