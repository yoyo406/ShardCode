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
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

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
  if (value === "length" || value === "MAX_TOKENS") return "length";
  if (value === "stop" || value === "STOP") return "stop";
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
  maxAttempts = 3,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<JsonRecord> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
      let response: Response;
      try {
        response = await fetcher(url, { ...init, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ProviderError(`${provider} request timed out`, { retryable: false, cause: error });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw new ProviderError(`${provider} response exceeded ${MAX_RESPONSE_BYTES} bytes`, {
          retryable: false,
          statusCode: response.status
        });
      }
      const text = await readResponseText(response, provider);
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
          await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
          continue;
        }
        throw new ProviderError(message, { retryable, statusCode: response.status });
      }
      return asRecord(body);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      lastError = error;
      if (attempt + 1 < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
        continue;
      }
    }
  }
  throw new ProviderError(`${provider} request failed`, { retryable: true, cause: lastError });
}

async function readResponseText(response: Response, provider: string): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new ProviderError(`${provider} response exceeded ${MAX_RESPONSE_BYTES} bytes`, {
        retryable: false,
        statusCode: response.status
      });
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ProviderError(`${provider} response exceeded ${MAX_RESPONSE_BYTES} bytes`, {
        retryable: false,
        statusCode: response.status
      });
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
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
