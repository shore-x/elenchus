// Elenchus - Session Runtime API
// This application-layer session is the stable surface that CLI and future UI layers consume,
// including optional persistence-backed cold-start recovery of the root deliberation graph.

import { initializeKnowledgeView } from "../core/knowledge-view-init.js";
import { DeliberationUnit } from "../core/unit/deliberation-unit.js";
import type { LlmClient, ToolExecutor } from "./ports.js";
import type { SessionPersistenceAdapter } from "./session-persistence.js";
import type { CommittedStep, OnSystemEvent, ToolLevel, UnitState } from "../core/types.js";

export interface DeliberationSessionOptions {
  llmClient: LlmClient;
  toolExecutor: ToolExecutor;
  runDirectory: string;
  level?: ToolLevel;
  onSystemEvent?: OnSystemEvent;
  persistence?: SessionPersistenceAdapter;
}

export class DeliberationSession {
  private readonly unit: DeliberationUnit;
  private readonly persistence: SessionPersistenceAdapter | null;

  constructor(options: DeliberationSessionOptions) {
    this.persistence = options.persistence ?? null;
    initializeKnowledgeView(options.runDirectory);
    const restoredSnapshot = this.persistence?.loadSnapshot() ?? null;

    this.unit = new DeliberationUnit({
      llmClient: options.llmClient,
      toolExecutor: options.toolExecutor,
      runDirectory: options.runDirectory,
      level: restoredSnapshot?.level ?? options.level,
      path: restoredSnapshot?.path,
      unitId: restoredSnapshot?.unitId,
      onSystemEvent: options.onSystemEvent,
      onDurableStateChange: () => {
        this.persist();
      },
    });

    if (restoredSnapshot) {
      this.unit.restoreFromSnapshot(restoredSnapshot, {
        includeUnmountedChildren: false,
        coldStart: true,
      });
    }

    this.persist();
  }

  close(): void {
    this.unit.close();
    this.persist();
    this.persistence?.close?.();
  }

  sendUserMessage(content: string): void {
    this.unit.injectUserMessage(content);
  }

  terminate(): void {
    this.unit.terminate();
    this.persist();
  }

  getState(): UnitState {
    return this.unit.getState();
  }

  getCommittedSteps(limit?: number): readonly CommittedStep[] {
    return this.unit.getCommittedSteps(limit);
  }

  private persist(): void {
    if (!this.persistence) {
      return;
    }

    this.persistence.saveSnapshot(this.unit.exportSnapshot());
  }
}
