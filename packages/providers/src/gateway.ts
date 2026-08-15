import type { ModelProvider, ProviderConfig } from "@shardcode/shared";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAICompatibleProvider } from "./openai-compatible.js";
import { createResponsesProvider } from "./responses.js";

export function createGatewayProvider(config: ProviderConfig): ModelProvider {
  switch (config.protocol) {
    case "openai-responses":
      return createResponsesProvider(config);
    case "anthropic":
      return createAnthropicProvider(config);
    case "openai-chat":
    case "gateway":
    case "mistral":
    case undefined:
      return createOpenAICompatibleProvider(config);
    case "gemini":
      throw new Error("Gemini models cannot use a gateway adapter");
  }
  throw new Error(`Unsupported gateway protocol: ${String(config.protocol)}`);
}
