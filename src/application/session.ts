// Elenchus - Session Runtime API
// This application-layer session is the stable surface that CLI and future UI layers consume.

import { DeliberationUnit } from "../core/unit/deliberation-unit.js";
import type { LlmClient, ToolExecutor } from "./ports.js";
import type { CommittedStep, OnSystemEvent, ToolLevel, UnitState } from "../core/types.js";

export interface DeliberationSessionOptions {
  llmClient: LlmClient;
  toolExecutor: ToolExecutor;
  level?: ToolLevel;
  onSystemEvent?: OnSystemEvent;
}

export class DeliberationSession {
  private readonly unit: DeliberationUnit;

  constructor(options: DeliberationSessionOptions) {
    this.unit = new DeliberationUnit({
      llmClient: options.llmClient,
      toolExecutor: options.toolExecutor,
      level: options.level,
      onSystemEvent: options.onSystemEvent,
    });
  }

  sendUserMessage(content: string): void {
    this.unit.injectUserMessage(content);
  }

  terminate(): void {
    this.unit.terminate();
  }

  getState(): UnitState {
    return this.unit.getState();
  }

  getCommittedSteps(limit?: number): readonly CommittedStep[] {
    return this.unit.getCommittedSteps(limit);
  }
}
