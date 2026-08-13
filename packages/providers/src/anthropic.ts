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
  toolDefinitionsForAnthropic
} from "./provider.js";

function messagesForAnthropic(messages: ModelMessage[]): Record<string, unknown>[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.toolCallId ?? "unknown-tool-call",
              content: message.content
            }
          ]
        };
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        const content: Record<string, unknown>[] = [];
        if (message.content) content.push({ type: "text", text: message.content });
        for (const call of message.toolCalls) {
          content.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
        }
        return { role: "assistant", content };
      }
      return { role: message.role === "assistant" ? "assistant" : "user", content: message.content };
    });
}

export function createAnthropicProvider(config: ProviderConfig): ModelProvider {
  const apiKey = requireApiKey(config);
  const fetcher = getFetch(config);
  const endpoint = config.baseUrl ?? "https://api.anthropic.com/v1/messages";
  return {
    id: config.provider,
    model: config.model,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxOutputTokens ?? 4096,
        messages: messagesForAnthropic(request.messages),
        tools: toolDefinitionsForAnthropic(request.tools)
      };
      const system = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      if (system) body.system = system;
      if (request.temperature !== undefined) body.temperature = request.temperature;
      const payload = await fetchJson(
        fetcher,
        endpoint,
        {
          method: "POST",
          headers: requestHeaders({
            ...(config.provider === "anthropic" || config.provider === "anthropic-claude"
              ? { "x-api-key": apiKey }
              : { Authorization: `Bearer ${apiKey}` }),
            "anthropic-version": "2023-06-01"
          }),
          body: JSON.stringify(body)
        },
        "Anthropic"
      );
      const blocks = asArray(payload.content);
      const text = blocks
        .map((block) => asRecord(block))
        .filter((block) => block.type === "text")
        .map((block) => asString(block.text) ?? "")
        .join("");
      const toolCalls: ModelToolCall[] = blocks.flatMap((block) => {
        const value = asRecord(block);
        const id = asString(value.id);
        const name = asString(value.name);
        if (value.type !== "tool_use" || !id || !name) return [];
        return [{ id, name, arguments: value.input ?? {} }];
      });
      const usage = asRecord(payload.usage);
      return {
        message: assistantMessage(text, toolCalls),
        toolCalls,
        finishReason: normalizeFinishReason(payload.stop_reason, toolCalls.length > 0),
        usage: normalizeUsage(usage.input_tokens, usage.output_tokens, undefined)
      };
    }
  };
}
