import type { ModelMessage, ModelProvider, ModelRequest, ModelResponse, ModelToolCall, ProviderConfig } from "@shardcode/shared";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  assistantMessage,
  fetchJson,
  getFetch,
  normalizeFinishReason,
  normalizeUsage,
  requireApiKey,
  requestHeaders,
  toolDefinitionsForGemini
} from "./provider.js";

function contentsForGemini(messages: ModelMessage[]): Record<string, unknown>[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "tool") {
        return {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: message.toolName ?? "unknown-tool",
                response: { content: message.content }
              }
            }
          ]
        };
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        const parts: Record<string, unknown>[] = [];
        if (message.content) parts.push({ text: message.content });
        for (const call of message.toolCalls) {
          parts.push({ functionCall: { name: call.name, args: call.arguments } });
        }
        return { role: "model", parts };
      }
      return {
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
      };
    });
}

export function createGeminiProvider(config: ProviderConfig): ModelProvider {
  const apiKey = requireApiKey(config);
  const fetcher = getFetch(config);
  const endpoint =
    config.baseUrl ??
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  return {
    id: "gemini",
    model: config.model,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const body: Record<string, unknown> = {
        contents: contentsForGemini(request.messages),
        tools: toolDefinitionsForGemini(request.tools)
      };
      const system = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (request.maxOutputTokens !== undefined || request.temperature !== undefined) {
        const generationConfig: Record<string, unknown> = {};
        if (request.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = request.maxOutputTokens;
        if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
        body.generationConfig = generationConfig;
      }
      const payload = await fetchJson(
        fetcher,
        endpoint,
        {
          method: "POST",
          headers: requestHeaders({ "x-goog-api-key": apiKey }),
          body: JSON.stringify(body)
        },
        "Gemini",
        3,
        config.timeoutMs
      );
      const candidate = asRecord(asArray(payload.candidates)[0]);
      const parts = asArray(asRecord(candidate.content).parts);
      const text = parts
        .map((part) => asRecord(part))
        .map((part) => asString(part.text) ?? "")
        .join("");
      const toolCalls: ModelToolCall[] = parts.flatMap((part, index) => {
        const value = asRecord(part);
        const functionCall = asRecord(value.functionCall);
        const name = asString(functionCall.name);
        if (!name) return [];
        return [{ id: `gemini-call-${index + 1}`, name, arguments: functionCall.args ?? {} }];
      });
      const usage = asRecord(payload.usageMetadata);
      return {
        message: assistantMessage(text, toolCalls),
        toolCalls,
        finishReason: normalizeFinishReason(candidate.finishReason, toolCalls.length > 0),
        usage: normalizeUsage(usage.promptTokenCount, usage.candidatesTokenCount, usage.totalTokenCount)
      };
    }
  };
}
