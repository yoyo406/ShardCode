import { ProviderError } from "@shardcode/shared";
import type {
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
  ProviderConfig,
  TokenUsage,
  ToolDefinition
} from "@shardcode/shared";

export type FetchFunction = NonNullable<ProviderConfig["fetch"]>;
export type JsonRecord = Record<string, unknown>;

export function getFetch(config: ProviderConfig): FetchFunction {
  return config.fetch ?? globalThis.fetch;
}

export function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { raw: value };
  }
}

export function normalizeUsage(
  inputTokens: unknown,
  outputTokens: unknown,
  totalTokens: unknown
): TokenUsage | undefined {
  const input = asNumber(inputTokens);
  const output = asNumber(outputTokens);
  const total = asNumber(totalTokens) ?? (input !== undefined && output !== undefined ? input + output : undefined);
  if (input === undefined || output === undefined || total === undefined) return undefined;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

export function toolDefinitionsForOpenAI(tools: ToolDefinition[]): JsonRecord[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

export function toolDefinitionsForAnthropic(tools: ToolDefinition[]): JsonRecord[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }));
}

export function toolDefinitionsForGemini(tools: ToolDefinition[]): JsonRecord[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }))
    }
  ];
}

export function normalizeFinishReason(value: unknown, hasToolCalls: boolean): ModelResponse["finishReason"] {
  if (hasToolCalls) return "tool_call";
  if (value === "length" || value === "MAX_TOKENS" || value === "max_tokens" || value === "incomplete") return "length";
  if (value === "stop" || value === "STOP" || value === "completed" || value === "end_turn" || value === "stop_sequence") return "stop";
  return "unknown";
}

export function assistantMessage(content: string, toolCalls: ModelToolCall[] = []): ModelMessage {
  const message: ModelMessage = { role: "assistant", content };
  if (toolCalls.length > 0) message.toolCalls = toolCalls;
  return message;
}

export async function fetchJson(
  fetcher: FetchFunction,
  url: string,
  init: RequestInit,
  provider: string,
  maxAttempts = 3
): Promise<JsonRecord> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      if (init.signal?.aborted) {
        throw init.signal.reason instanceof Error ? init.signal.reason : new Error("provider request aborted");
      }
      const response = await fetcher(url, init);
      const text = await response.text();
      let body: unknown = {};
      if (text.length > 0) {
        try {
          body = JSON.parse(text) as unknown;
        } catch (error) {
          throw new ProviderError(`${provider} returned invalid JSON`, {
            retryable: false,
            statusCode: response.status,
            cause: error
          });
        }
      }
      if (!response.ok) {
        const message = asString(asRecord(asRecord(body).error).message) ?? `${provider} request failed (${response.status})`;
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt + 1 < maxAttempts) {
          await abortableDelay(100 * 2 ** attempt, init.signal);
          continue;
        }
        throw new ProviderError(message, { retryable, statusCode: response.status });
      }
      return asRecord(body);
    } catch (error) {
      if (init.signal?.aborted) {
        throw init.signal.reason instanceof Error ? init.signal.reason : new Error("provider request aborted");
      }
      if (error instanceof ProviderError) throw error;
      lastError = error;
      if (attempt + 1 < maxAttempts) {
        await abortableDelay(100 * 2 ** attempt, init.signal);
        continue;
      }
    }
  }
  throw new ProviderError(`${provider} request failed`, { retryable: true, cause: lastError });
}

export function requireApiKey(config: ProviderConfig): string {
  if (!config.apiKey) {
    throw new ProviderError(`${config.provider} requires an API key`, { retryable: false });
  }
  return config.apiKey;
}

export function requestHeaders(headers: Record<string, string>): HeadersInit {
  return { "content-type": "application/json", ...headers };
}

function abortableDelay(milliseconds: number, signal: AbortSignal | null | undefined): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error("provider request aborted"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("provider request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
