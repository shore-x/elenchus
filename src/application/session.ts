// Elenchus - Session Runtime API
// This application-layer session is the stable surface that CLI and future UI layers consume,
// including optional persistence-backed cold-start recovery of the root deliberation graph.

import { compareSkillBindings, createCapabilityBundle, type CapabilityBundle } from "../core/skills.js";
import { DeliberationUnit } from "../core/unit/deliberation-unit.js";
import type { LlmClient, ToolExecutor } from "./ports.js";
import type { SessionPersistenceAdapter } from "./session-persistence.js";
import type { CommittedStep, OnSystemEvent, ToolLevel, UnitState } from "../core/types.js";

export interface DeliberationSessionOptions {
  llmClient: LlmClient;
  toolExecutor: ToolExecutor;
  capabilities?: CapabilityBundle;
  level?: ToolLevel;
  onSystemEvent?: OnSystemEvent;
  persistence?: SessionPersistenceAdapter;
}

export class DeliberationSession {
  private readonly unit: DeliberationUnit;
  private readonly persistence: SessionPersistenceAdapter | null;
  private readonly capabilities: CapabilityBundle;

  constructor(options: DeliberationSessionOptions) {
    this.persistence = options.persistence ?? null;
    this.capabilities = options.capabilities ?? createCapabilityBundle();
    const restoredSnapshot = this.persistence?.loadSnapshot() ?? null;
    const persistedSkillBindings = this.persistence?.loadSkillBindings?.() ?? null;

    this.unit = new DeliberationUnit({
      llmClient: options.llmClient,
      toolExecutor: options.toolExecutor,
      capabilities: this.capabilities,
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

      if (persistedSkillBindings) {
        const bindingWarnings = compareSkillBindings(persistedSkillBindings, this.capabilities.getSkillBindings());
        for (const warning of bindingWarnings) {
          this.unit.appendSystemNotice(warning);
        }
      }
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
    this.persistence.saveSkillBindings?.(this.capabilities.getSkillBindings());
  }
}
