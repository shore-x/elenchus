// Elenchus GUI - Onboarding / Config Page
// First-run configuration wizard for LLM provider, API key, base URL, and project directory.
// Self-contained: does not require sidecar connection (sidecar starts after config is complete).

import { useState } from "react";

const KNOWN_PROVIDERS = [
  { id: "anthropic", name: "Anthropic" },
  { id: "openai", name: "OpenAI" },
  { id: "google", name: "Google" },
  { id: "xai", name: "xAI" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "ollama", name: "Ollama (local)" },
];

const KNOWN_MODELS: Record<string, { id: string; name: string }[]> = {
  anthropic: [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "claude-haiku-4-20250514", name: "Claude Haiku 4" },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
  ],
  openai: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "o1", name: "o1" },
  ],
  google: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
  xai: [
    { id: "grok-3", name: "Grok 3" },
  ],
  deepseek: [
    { id: "deepseek-chat", name: "DeepSeek Chat" },
    { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
  ],
  ollama: [],
};

interface OnboardingPageProps {
  onComplete: (config: {
    provider: string;
    modelName: string;
    apiKey: string;
    baseUrl?: string;
    projectRoot: string;
  }) => void;
  initialConfig?: {
    provider?: string;
    modelName?: string;
    baseUrl?: string;
    projectRoot?: string;
  };
  error?: string | null;
}

export function OnboardingPage({ onComplete, initialConfig, error }: OnboardingPageProps){
  const [provider, setProvider] = useState(initialConfig?.provider ?? "anthropic");
  const [modelName, setModelName] = useState(initialConfig?.modelName ?? "claude-sonnet-4-20250514");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initialConfig?.baseUrl ?? "");
  const [projectRoot, setProjectRoot] = useState(initialConfig?.projectRoot ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const models = KNOWN_MODELS[provider] ?? [];

  const handleSubmit = async () => {
    if (!provider || !modelName || !apiKey) {
      setLocalError("Provider, model, and API key are required.");
      return;
    }

    // Ollama doesn't require an API key but needs a base URL
    if (provider === "ollama" && !baseUrl) {
      setLocalError("Ollama requires a base URL (e.g. http://localhost:11434)");
      return;
    }

    setSubmitting(true);
    setLocalError(null);

    onComplete({
      provider,
      modelName,
      apiKey,
      baseUrl: baseUrl || undefined,
      projectRoot: projectRoot || "~/Elenchus",
    });
    setSubmitting(false);
  };

  return (
    <div className="flex flex-col h-screen bg-[var(--color-bg)]">
      <div className="titlebar-drag" />
      <div className="flex items-center justify-center flex-1">
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-stone-200 p-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-1">Welcome to Elenchus</h1>
        <p className="text-sm text-gray-500 mb-6">Configure your LLM provider to get started.</p>

        {/* Provider */}
        <label className="block text-sm font-medium text-gray-700 mb-1">LLM Provider</label>
        <select
          className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-stone-400"
          value={provider}
          onChange={(e) => { setProvider(e.target.value); setModelName(""); }}
        >
          {KNOWN_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* Model */}
        <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
        <select
          className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-stone-400"
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
          {models.length === 0 && <option value={modelName}>{modelName}</option>}
        </select>

        {/* API Key */}
        <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
        <input
          type="password"
          className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-stone-400"
          placeholder="Enter your API key..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />

        {/* Base URL */}
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Base URL <span className="text-gray-400 font-normal">(optional, for third-party providers)</span>
        </label>
        <input
          type="text"
          className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-stone-400"
          placeholder="https://..."
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />

        {/* Project Directory */}
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Project Directory <span className="text-gray-400 font-normal">(agent working directory)</span>
        </label>
        <input
          type="text"
          className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:border-stone-400"
          placeholder={projectRoot || "~/Elenchus"}
          value={projectRoot}
          onChange={(e) => setProjectRoot(e.target.value)}
        />

        {/* Error */}
        {(error || localError) && (
          <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error ?? localError}</div>
        )}

        {/* Submit */}
        <button
          className="w-full py-2.5 bg-stone-800 text-white rounded-lg text-sm font-medium hover:bg-stone-700 disabled:opacity-50"
          onClick={handleSubmit}
          disabled={submitting || !apiKey}
        >
          {submitting ? "Starting..." : "Start"}
        </button>
      </div>
      </div>
    </div>
  );
}
