import type { AvailableModel, ProviderId, ProviderProtocol } from "@shardcode/shared";

export type ConnectableProviderId =
  | "openai"
  | "openai-codex"
  | "google-gemini"
  | "mistral"
  | "anthropic-claude"
  | "opencode-zen"
  | "opencode-go"
  | "cline"
  | "kilo-code";

export interface ProviderDefinition {
  id: ConnectableProviderId;
  label: string;
  protocol: ProviderProtocol;
  discovery: "remote" | "catalog";
  modelsEndpoint?: string;
  modelFilter?: (modelId: string) => boolean;
  requestHeaders: (apiKey: string) => Record<string, string>;
  modelDetails: (modelId: string, label: string) => Pick<AvailableModel, "protocol" | "baseUrl">;
}

const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const GEMINI_MODELS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const MISTRAL_CHAT_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";

function bearerHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

function openAiDetails(_modelId: string, _label: string): Pick<AvailableModel, "protocol" | "baseUrl"> {
  return { protocol: "openai-chat", baseUrl: OPENAI_CHAT_ENDPOINT };
}

function codexDetails(_modelId: string, _label: string): Pick<AvailableModel, "protocol" | "baseUrl"> {
  return { protocol: "openai-responses", baseUrl: OPENAI_RESPONSES_ENDPOINT };
}

function geminiDetails(modelId: string, _label: string): Pick<AvailableModel, "protocol" | "baseUrl"> {
  return {
    protocol: "gemini",
    baseUrl: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`
  };
}

function opencodeDetails(family: "zen" | "go", modelId: string): Pick<AvailableModel, "protocol" | "baseUrl"> {
  const normalized = modelId.toLowerCase();
  const root = family === "zen" ? "https://opencode.ai/zen/v1" : "https://opencode.ai/zen/go/v1";
  if (normalized.includes("claude") || normalized.includes("anthropic") || normalized.includes("qwen") || normalized.includes("minimax")) {
    return { protocol: "anthropic", baseUrl: `${root}/messages` };
  }
  if (normalized.includes("gpt") || normalized.includes("grok") || normalized.includes("codex")) {
    return { protocol: "openai-responses", baseUrl: `${root}/responses` };
  }
  return { protocol: "openai-chat", baseUrl: `${root}/chat/completions` };
}

function gatewayDetails(baseUrl: string): Pick<AvailableModel, "protocol" | "baseUrl"> {
  return { protocol: "gateway", baseUrl };
}

const definitions: Record<ConnectableProviderId, ProviderDefinition> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-chat",
    discovery: "remote",
    modelsEndpoint: "https://api.openai.com/v1/models",
    requestHeaders: bearerHeaders,
    modelDetails: openAiDetails
  },
  "openai-codex": {
    id: "openai-codex",
    label: "OpenAI-Codex",
    protocol: "openai-responses",
    discovery: "remote",
    modelsEndpoint: "https://api.openai.com/v1/models",
    modelFilter: (modelId) => /codex|coding/i.test(modelId),
    requestHeaders: bearerHeaders,
    modelDetails: codexDetails
  },
  "google-gemini": {
    id: "google-gemini",
    label: "Google-Gemini",
    protocol: "gemini",
    discovery: "remote",
    modelsEndpoint: GEMINI_MODELS_ENDPOINT,
    requestHeaders: (apiKey) => ({ "x-goog-api-key": apiKey }),
    modelDetails: geminiDetails
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    protocol: "mistral",
    discovery: "remote",
    modelsEndpoint: "https://api.mistral.ai/v1/models",
    requestHeaders: bearerHeaders,
    modelDetails: (_modelId, _label) => ({ protocol: "mistral", baseUrl: MISTRAL_CHAT_ENDPOINT })
  },
  "anthropic-claude": {
    id: "anthropic-claude",
    label: "Anthropic-Claude",
    protocol: "anthropic",
    discovery: "remote",
    modelsEndpoint: "https://api.anthropic.com/v1/models",
    requestHeaders: (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": "2023-06-01" }),
    modelDetails: (_modelId, _label) => ({ protocol: "anthropic", baseUrl: ANTHROPIC_MESSAGES_ENDPOINT })
  },
  "opencode-zen": {
    id: "opencode-zen",
    label: "OpenCode ZEN",
    protocol: "gateway",
    discovery: "remote",
    modelsEndpoint: "https://opencode.ai/zen/v1/models",
    requestHeaders: bearerHeaders,
    modelDetails: (modelId, _label) => opencodeDetails("zen", modelId)
  },
  "opencode-go": {
    id: "opencode-go",
    label: "OpenCode GO",
    protocol: "gateway",
    discovery: "remote",
    modelsEndpoint: "https://opencode.ai/zen/go/v1/models",
    requestHeaders: bearerHeaders,
    modelDetails: (modelId, _label) => opencodeDetails("go", modelId)
  },
  cline: {
    id: "cline",
    label: "Cline (api key)",
    protocol: "openai-chat",
    discovery: "catalog",
    requestHeaders: bearerHeaders,
    modelDetails: (_modelId, _label) => ({ protocol: "openai-chat", baseUrl: "https://api.cline.bot/api/v1/chat/completions" })
  },
  "kilo-code": {
    id: "kilo-code",
    label: "Kilo-code (api key)",
    protocol: "gateway",
    discovery: "remote",
    modelsEndpoint: "https://api.kilo.ai/api/gateway/models",
    requestHeaders: (_apiKey) => ({}),
    modelDetails: (_modelId, _label) => gatewayDetails("https://api.kilo.ai/api/gateway/chat/completions")
  }
};

export const PROVIDER_CATALOG: readonly ProviderDefinition[] = Object.values(definitions);

export function getProviderDefinition(providerId: ConnectableProviderId): ProviderDefinition {
  return definitions[providerId];
}

export function staticModelsFor(providerId: "cline"): AvailableModel[] {
  const definition = definitions[providerId];
  const models = [
    ["anthropic/claude-sonnet-4-6", "Anthropic / Claude Sonnet 4.6"],
    ["openai/gpt-4o", "OpenAI / GPT-4o"],
    ["google/gemini-2.5-pro", "Google / Gemini 2.5 Pro"],
    ["minimax/minimax-m2.5", "MiniMax / MiniMax M2.5"],
    ["openai/gpt-5", "OpenAI / GPT-5"],
    ["google/gemini-2.5-flash", "Google / Gemini 2.5 Flash"]
  ] as const;

  return models.map(([id, label]) => ({
    id,
    label,
    providerId,
    ...definition.modelDetails(id, label)
  }));
}
