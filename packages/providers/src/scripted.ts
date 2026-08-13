import { ProviderError } from "@shardcode/shared";
import type { ModelProvider, ModelRequest, ModelResponse } from "@shardcode/shared";

export function createScriptedProvider(model: string, responses: ModelResponse[]): ModelProvider {
  let index = 0;
  return {
    id: "scripted",
    model,
    async complete(_request: ModelRequest): Promise<ModelResponse> {
      const response = responses[index];
      index += 1;
      if (!response) {
        throw new ProviderError("Scripted provider has no response left", { retryable: false });
      }
      return response;
    }
  };
}
