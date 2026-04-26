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
  workspaceRoot: string;
  projectRoot: string;
  level?: ToolLevel;
  onSystemEvent?: OnSystemEvent;
  persistence?: SessionPersistenceAdapter;
}

export class DeliberationSession {
  private readonly unit: DeliberationUnit;
  private readonly persistence: SessionPersistenceAdapter | null;

  constructor(options: DeliberationSessionOptions) {
    this.persistence = options.persistence ?? null;
    initializeKnowledgeView(options.workspaceRoot);
    const restoredSnapshot = this.persistence?.loadSnapshot() ?? null;

    this.unit = new DeliberationUnit({
      llmClient: options.llmClient,
      toolExecutor: options.toolExecutor,
      workspaceRoot: options.workspaceRoot,
      projectRoot: options.projectRoot,
      level: restoredSnapshot?.level ?? options.level,
      path: restoredSnapshot?.path,
      unitId: restoredSnapshot?.unitId,
      onSystemEvent: options.onSystemEvent,
      onDurableStateChange: () => {
        this.persist();
      },
      messagePersistenceSink: this.persistence ? {
        onMessageCreated: (message, seq) => {
          this.persistence!.appendMessage(this.unit.getUnitId(), seq, message);
        },
        onMessageUpdated: (message) => {
          this.persistence!.updateMessage(this.unit.getUnitId(), message);
        },
      } : undefined,
      contextPersistenceSink: this.persistence ?? undefined,
    });

    if (restoredSnapshot) {
      this.unit.restoreFromSnapshot(restoredSnapshot, {
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

  getUnitId(): string {
    return this.unit.getUnitId();
  }

  exportSnapshot() {
    return this.unit.exportSnapshot();
  }

  getRootUnit(): DeliberationUnit {
    return this.unit;
  }

  private persist(): void {
    if (!this.persistence) {
      return;
    }

    this.persistence.saveSnapshot(this.unit.exportSnapshot());
  }
}
