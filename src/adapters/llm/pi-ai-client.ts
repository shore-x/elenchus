// Elenchus - pi-ai LLM Adapter
// Bridges the abstract LlmClient port to the concrete pi-ai SDK.

import { complete, getModel, type Context, type Model, type Tool } from "@mariozechner/pi-ai";
import type { LlmClient, LlmContext, LlmResponse } from "../../core/ports.js";

export interface PiAiModelConfig {
  provider: string;
  modelName: string;
  baseUrl?: string;
}

export class PiAiLlmClient implements LlmClient {
  constructor(private readonly model: Model<any>) {}

  async complete(context: LlmContext, options: { maxTokens: number }): Promise<LlmResponse> {
    const response = await complete(this.model, {
      systemPrompt: context.systemPrompt,
      messages: context.messages as Context["messages"],
      tools: context.tools as Tool[],
    }, options);

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
