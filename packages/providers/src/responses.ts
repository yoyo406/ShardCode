import type { ModelMessage, ModelProvider, ModelRequest, ModelResponse, ModelToolCall, ProviderConfig } from "@shardcode/shared";
import {
  asArray,
  asRecord,
  asString,
  assistantMessage,
  fetchJson,
  getFetch,
  normalizeFinishReason,
  normalizeUsage,
  parseArguments,
  requireApiKey,
  requestHeaders
} from "./provider.js";

function inputForResponses(messages: ModelMessage[]): Record<string, unknown>[] {
  return messages.flatMap((message) => {
    if (message.role === "tool") {
      return [{ type: "function_call_output", call_id: message.toolCallId ?? "unknown-tool-call", output: message.content }];
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      const items: Record<string, unknown>[] = [];
      if (message.content) items.push({ role: "assistant", content: message.content });
      for (const call of message.toolCalls) {
        items.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments)
        });
      }
      return items;
    }
    return [{ role: message.role, content: message.content }];
  });
}

function toolsForResponses(request: ModelRequest): Record<string, unknown>[] {
  return request.tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema
  }));
}

function outputText(item: Record<string, unknown>): string {
  return asArray(item.content)
    .map((part) => asString(asRecord(part).text) ?? "")
    .join("");
}

export function createResponsesProvider(config: ProviderConfig): ModelProvider {
  const apiKey = requireApiKey(config);
  const fetcher = getFetch(config);
  const endpoint = config.baseUrl ?? "https://api.openai.com/v1/responses";
  return {
    id: config.provider,
    model: config.model,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const body: Record<string, unknown> = {
        model: request.model,
        input: inputForResponses(request.messages),
        tools: toolsForResponses(request)
      };
      if (request.maxOutputTokens !== undefined) body.max_output_tokens = request.maxOutputTokens;
      if (request.temperature !== undefined) body.temperature = request.temperature;
      const payload = await fetchJson(
        fetcher,
        endpoint,
        {
          method: "POST",
          headers: requestHeaders({ Authorization: `Bearer ${apiKey}` }),
          body: JSON.stringify(body)
        },
        config.provider
      );
      const output = asArray(payload.output).map(asRecord);
      const toolCalls: ModelToolCall[] = output.flatMap((item) => {
        if (item.type !== "function_call") return [];
        const id = asString(item.call_id) ?? asString(item.id);
        const name = asString(item.name);
        if (!id || !name) return [];
        return [{ id, name, arguments: parseArguments(item.arguments) }];
      });
      const content = output
        .filter((item) => item.type === "message")
        .map(outputText)
        .join("") || asString(payload.output_text) || "";
      const usage = asRecord(payload.usage);
      return {
        message: assistantMessage(content, toolCalls),
        toolCalls,
        finishReason: normalizeFinishReason(payload.status, toolCalls.length > 0),
        usage: normalizeUsage(usage.input_tokens, usage.output_tokens, usage.total_tokens)
      };
    }
  };
}
