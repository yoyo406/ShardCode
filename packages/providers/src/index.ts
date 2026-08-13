import type { ModelProvider, ProviderConfig } from "@shardcode/shared";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
export { createScriptedProvider } from "./scripted.js";

export function createProvider(config: ProviderConfig): ModelProvider {
  switch (config.provider) {
    case "openai":
      return createOpenAIProvider(config);
    case "anthropic":
      return createAnthropicProvider(config);
    case "gemini":
      return createGeminiProvider(config);
    case "scripted":
      throw new Error("Use createScriptedProvider for the scripted provider");
  }
}

export { createAnthropicProvider, createGeminiProvider, createOpenAIProvider };
