// Elenchus - pi-ai LLM Adapter
// Bridges the abstract LlmClient port to the concrete pi-ai SDK.

import { complete, getModel, type Context, type Model, type Tool } from "@mariozechner/pi-ai";
import type { LlmClient, LlmContext, LlmModelInfo, LlmResponse } from "../../core/ports.js";

export interface PiAiModelConfig {
  provider: string;
  modelName: string;
  baseUrl?: string;
}

export class PiAiLlmClient implements LlmClient {
  constructor(private readonly model: Model<any>) {}

  getModelInfo(): LlmModelInfo {
    return {
      contextWindowTokens: this.model.contextWindow,
      maxOutputTokens: this.model.maxTokens,
    };
  }

  async complete(context: LlmContext, options: { maxTokens: number; signal?: AbortSignal }): Promise<LlmResponse> {
    const response = await complete(this.model, {
      systemPrompt: context.systemPrompt,
      messages: context.messages as Context["messages"],
      tools: context.tools as Tool[],
    }, { maxTokens: options.maxTokens, signal: options.signal });

    const result = response as unknown as LlmResponse;
    if ((response as any).errorMessage) {
      result.errorMessage = (response as any).errorMessage;
    }
    return result;
  }
}

export function createPiAiLlmClient(config: PiAiModelConfig): PiAiLlmClient | null {
  const model = getModel(config.provider as any, config.modelName as any);
  if (!model) {
    return null;
  }
  if (config.baseUrl) {
    model.baseUrl = config.baseUrl;
  }
  return new PiAiLlmClient(model);
}
