import type { ModelProvider, ProviderConfig } from "@shardcode/shared";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
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
      return createOpenAIProvider(config);
    case "mistral":
      return createOpenAIProvider(config);
    case "opencode-zen":
    case "opencode-go":
    case "cline":
    case "kilo-code":
      return createOpenAIProvider(config);
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
