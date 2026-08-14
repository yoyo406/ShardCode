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
  parseArguments,
  requireApiKey,
  requestHeaders,
  toolDefinitionsForOpenAI
} from "./provider.js";

function messageForOpenAI(message: ModelMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId ?? "unknown-tool-call",
      content: message.content
    };
  }
  const result: Record<string, unknown> = { role: message.role, content: message.content };
  if (message.role === "assistant" && message.toolCalls?.length) {
    result.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.arguments) }
    }));
  }
  return result;
}

export function createOpenAIProvider(config: ProviderConfig): ModelProvider {
  const apiKey = requireApiKey(config);
  const fetcher = getFetch(config);
  const endpoint = config.baseUrl ?? "https://api.openai.com/v1/chat/completions";
  return {
    id: "openai",
    model: config.model,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: request.messages.map(messageForOpenAI),
        tools: toolDefinitionsForOpenAI(request.tools)
      };
      if (request.maxOutputTokens !== undefined) body.max_tokens = request.maxOutputTokens;
      if (request.temperature !== undefined) body.temperature = request.temperature;
      const payload = await fetchJson(
        fetcher,
        endpoint,
        {
          method: "POST",
          headers: requestHeaders({ Authorization: `Bearer ${apiKey}` }),
          body: JSON.stringify(body),
          ...(request.signal ? { signal: request.signal } : {})
        },
        "OpenAI"
      );
      const choice = asRecord(asArray(payload.choices)[0]);
      const rawMessage = asRecord(choice.message);
      const rawCalls = asArray(rawMessage.tool_calls);
      const toolCalls: ModelToolCall[] = rawCalls.flatMap((rawCall) => {
        const call = asRecord(rawCall);
        const functionData = asRecord(call.function);
        const id = asString(call.id);
        const name = asString(functionData.name);
        if (!id || !name) return [];
        return [{ id, name, arguments: parseArguments(functionData.arguments) }];
      });
      const content = asString(rawMessage.content) ?? "";
      const usage = asRecord(payload.usage);
      return {
        message: assistantMessage(content, toolCalls),
        toolCalls,
        finishReason: normalizeFinishReason(choice.finish_reason, toolCalls.length > 0),
        usage: normalizeUsage(usage.prompt_tokens, usage.completion_tokens, usage.total_tokens)
      };
    }
  };
}
