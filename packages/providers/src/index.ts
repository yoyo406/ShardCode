import type { ModelProvider, ProviderConfig } from "@shardcode/shared";
import { createAnthropicProvider } from "./anthropic.js";
import { createGatewayProvider } from "./gateway.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
import { createOpenAICompatibleProvider } from "./openai-compatible.js";
import { createResponsesProvider } from "./responses.js";
export { createScriptedProvider } from "./scripted.js";
export {
  discoverModels,
  getProviderDefinition,
  PROVIDER_CATALOG,
  type DiscoveryOptions,
  type DiscoveryResult
} from "./discovery.js";
export { type ConnectableProviderId, type ProviderDefinition } from "./catalog.js";

export function createProvider(config: ProviderConfig): ModelProvider {
  switch (config.provider) {
    case "openai":
      return createOpenAIProvider(config);
    case "openai-codex":
      return createResponsesProvider(config);
    case "mistral":
      return createOpenAICompatibleProvider(config);
    case "opencode-zen":
    case "opencode-go":
      return createGatewayProvider(config);
    case "cline":
    case "kilo-code":
      return createOpenAICompatibleProvider(config);
    case "anthropic":
    case "anthropic-claude":
      return createAnthropicProvider(config);
    case "gemini":
    case "google-gemini":
      return createGeminiProvider(config);
    case "scripted":
      throw new Error("Use createScriptedProvider for the scripted provider");
  }
}

export { createAnthropicProvider, createGeminiProvider, createOpenAIProvider };
export { createGatewayProvider, createOpenAICompatibleProvider, createResponsesProvider };
