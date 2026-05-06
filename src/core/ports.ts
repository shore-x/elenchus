// Elenchus - Core Runtime Ports
// These ports isolate the core deliberation protocol from concrete LLM SDKs,
// tool execution environments, and future presentation layers.

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type LlmTextBlock = {
  type: "text";
  text: string;
};

export type LlmToolCallBlock = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LlmContentBlock = LlmTextBlock | LlmToolCallBlock;

export interface LlmUserMessage {
  role: "user";
  content: string;
  timestamp: number;
}

export interface LlmAssistantMessage {
  role: "assistant";
  content: LlmContentBlock[];
  stopReason: string;
  timestamp: number;
}

export interface LlmToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: LlmTextBlock[];
  isError: boolean;
  timestamp: number;
}

export type LlmMessage = LlmUserMessage | LlmAssistantMessage | LlmToolResultMessage;

export interface LlmContext {
  systemPrompt: string;
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
}

export interface LlmResponse extends LlmAssistantMessage {
  errorMessage?: string;
}

export interface LlmModelInfo {
  contextWindowTokens: number;
  maxOutputTokens: number;
}

export interface LlmClient {
  complete(context: LlmContext, options: { maxTokens: number; signal?: AbortSignal }): Promise<LlmResponse>;
  getModelInfo(): LlmModelInfo;
}

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  durationMs: number;
}

export interface ToolExecutor {
  execute(toolName: string, args: Record<string, unknown>, options?: { cwd?: string; level?: string; signal?: AbortSignal }): Promise<ToolExecutionResult>;
}
