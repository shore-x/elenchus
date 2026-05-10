// Elenchus GUI - IPC Hook
// Provides typed access to the Electron main process via window.electronAPI.
// Replaces the former useApi hook that used HTTP fetch to the sidecar server.

import { useCallback, useMemo } from "react";
import type { SessionInfo, UnitInfo, ConversationMessage, FsTreeNode, FileContent, ProviderInfo, ModelInfo } from "../lib/types";
import type { PaginatedMessagesResponse } from "../lib/electron-api";

function getApi() {
  if (!window.electronAPI) {
    console.error("[useIpc] window.electronAPI is not available — preload script may have failed to load");
  }
  return window.electronAPI;
}

export function useIpc() {
  const getSessionInfo = useCallback(async (): Promise<SessionInfo | null> => {
    return getApi().getSessionInfo();
  }, []);

  const getUnitInfo = useCallback(async (unitId: string): Promise<UnitInfo | null> => {
    return getApi().getUnitInfo(unitId);
  }, []);

  const getUnitMessages = useCallback(async (unitId: string, opts?: { before?: number; limit?: number }): Promise<PaginatedMessagesResponse> => {
    return getApi().getUnitMessages(unitId, opts);
  }, []);

  const sendMessage = useCallback(async (content: string): Promise<boolean> => {
    const result = await getApi().sendMessage(content);
    return result.ok;
  }, []);

  const terminateSession = useCallback(async (): Promise<boolean> => {
    const result = await getApi().terminateSession();
    return result.ok;
  }, []);

  const getFsTree = useCallback(async (mode: "docs" | "all"): Promise<FsTreeNode[]> => {
    return getApi().getFsTree(mode);
  }, []);

  const readFile = useCallback(async (path: string): Promise<FileContent | null> => {
    return getApi().readFile(path);
  }, []);

  const getProviders = useCallback(async (): Promise<ProviderInfo[]> => {
    return getApi().getProviders();
  }, []);

  const getModels = useCallback(async (provider: string): Promise<ModelInfo[]> => {
    return getApi().getModels(provider);
  }, []);

  const validateConfig = useCallback(async (config: { provider: string; modelName: string; baseUrl?: string }): Promise<{ valid: boolean; error?: string }> => {
    return getApi().validateConfig(config);
  }, []);

  const startSession = useCallback(async (config: Record<string, unknown>): Promise<SessionInfo | { error: string } | null> => {
    return getApi().startSession(config);
  }, []);

  const loadPersistedConfig = useCallback(async () => {
    return getApi().loadPersistedConfig();
  }, []);

  const savePersistedConfig = useCallback(async (config: Record<string, unknown>) => {
    return getApi().savePersistedConfig(config);
  }, []);

  const checkWorkspaceStatus = useCallback(async () => {
    return getApi().checkWorkspaceStatus();
  }, []);

  const reconstructContext = useCallback(async (messageId: string): Promise<{ ok: boolean; path?: string; name?: string; error?: string }> => {
    return getApi().reconstructContext(messageId);
  }, []);

  // Stable object reference — prevents downstream useCallback deps from
  // changing every render when consumers destructure from useIpc().
  return useMemo(() => ({
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
    startSession,
    loadPersistedConfig,
    savePersistedConfig,
    checkWorkspaceStatus,
    reconstructContext,
  }), [
    getSessionInfo, getUnitInfo, getUnitMessages, sendMessage,
    terminateSession, getFsTree, readFile, getProviders, getModels,
    validateConfig, startSession, loadPersistedConfig, savePersistedConfig,
    checkWorkspaceStatus, reconstructContext,
  ]);
}
