import { describe, expect, it } from "vitest";
import type { ModelRequest } from "@shardcode/shared";
import { createAnthropicProvider, createGatewayProvider, createOpenAICompatibleProvider, createProvider, createResponsesProvider } from "./index.js";

const request: ModelRequest = {
  model: "model-under-test",
  messages: [
    { role: "system", content: "You are a coding agent." },
    { role: "user", content: "Read README.md" }
  ],
  tools: [
    {
      name: "read_file",
      description: "Read a file",
      risk: "read",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
    }
  ]
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("runtime provider adapters", () => {
  it("runs OpenAI-compatible providers such as Mistral and preserves tool calls", async () => {
    let captured: { url: string; headers: Headers; body: Record<string, unknown> } | undefined;
    const provider = createOpenAICompatibleProvider({
      provider: "mistral",
      model: request.model,
      apiKey: "mistral-key",
      baseUrl: "https://api.mistral.ai/v1/chat/completions",
      fetch: async (input, init) => {
        captured = {
          url: String(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        };
        return jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: "I will read it.",
                tool_calls: [
                  { id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"README.md"}' } }
                ]
              },
              finish_reason: "tool_calls"
            }
          ],
          usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 }
        });
      }
    });

    const response = await provider.complete(request);

    expect(captured?.url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(captured?.headers.get("authorization")).toBe("Bearer mistral-key");
    expect(captured?.body.tools).toEqual([expect.objectContaining({ type: "function" })]);
    expect(response.message.content).toBe("I will read it.");
    expect(response.toolCalls[0]).toEqual({ id: "call-1", name: "read_file", arguments: { path: "README.md" } });
  });

  it("disables streaming for OpenAI-compatible JSON adapters", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = createOpenAICompatibleProvider({
      provider: "cline",
      model: request.model,
      apiKey: "cline-key",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ choices: [{ message: { role: "assistant", content: "Done" }, finish_reason: "stop" }] });
      }
    });

    await provider.complete(request);

    expect(body?.stream).toBe(false);
  });

  it("maps the Responses API input and function calls for OpenAI-Codex", async () => {
    let captured: { url: string; headers: Headers; body: Record<string, unknown> } | undefined;
    const provider = createResponsesProvider({
      provider: "openai-codex",
      model: request.model,
      apiKey: "codex-key",
      fetch: async (input, init) => {
        captured = {
          url: String(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        };
        return jsonResponse({
          status: "completed",
          output: [
            { type: "message", content: [{ type: "output_text", text: "I will read it." }] },
            { type: "function_call", call_id: "call-1", name: "read_file", arguments: '{"path":"README.md"}' }
          ],
          usage: { input_tokens: 9, output_tokens: 5, total_tokens: 14 }
        });
      }
    });

    const response = await provider.complete(request);

    expect(captured?.url).toBe("https://api.openai.com/v1/responses");
    expect(captured?.headers.get("authorization")).toBe("Bearer codex-key");
    expect(captured?.body.input).toEqual([
      { role: "system", content: "You are a coding agent." },
      { role: "user", content: "Read README.md" }
    ]);
    expect(captured?.body.tools).toEqual([
      expect.objectContaining({ type: "function", name: "read_file", parameters: request.tools[0]?.inputSchema })
    ]);
    expect(response.toolCalls[0]).toEqual({ id: "call-1", name: "read_file", arguments: { path: "README.md" } });
    expect(response.usage?.totalTokens).toBe(14);
    expect(response.finishReason).toBe("tool_call");
  });

  it("normalizes a completed Responses API response to a stop", async () => {
    const provider = createResponsesProvider({
      provider: "openai-codex",
      model: request.model,
      apiKey: "codex-key",
      fetch: async () => jsonResponse({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }]
      })
    });

    await expect(provider.complete(request)).resolves.toMatchObject({ finishReason: "stop" });
  });

  it("normalizes Anthropic terminal stop reasons", async () => {
    const provider = createAnthropicProvider({
      provider: "anthropic-claude",
      model: request.model,
      apiKey: "anthropic-key",
      fetch: async () => jsonResponse({
        content: [{ type: "text", text: "Truncated" }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 4, output_tokens: 2 }
      })
    });

    await expect(provider.complete(request)).resolves.toMatchObject({ finishReason: "length" });
  });

  it("routes gateway providers through their configured protocol", async () => {
    let headers: Headers | undefined;
    const provider = createGatewayProvider({
      provider: "opencode-zen",
      protocol: "openai-chat",
      model: request.model,
      apiKey: "zen-key",
      baseUrl: "https://opencode.ai/zen/v1/chat/completions",
      fetch: async (_input, init) => {
        headers = new Headers(init?.headers);
        return jsonResponse({ choices: [{ message: { role: "assistant", content: "Done" }, finish_reason: "stop" }] });
      }
    });

    await expect(provider.complete(request)).resolves.toMatchObject({ message: { content: "Done" } });
    expect(headers?.get("authorization")).toBe("Bearer zen-key");
  });

  it("dispatches normalized provider ids from the shared factory", () => {
    expect(createProvider({ provider: "openai-codex", model: "codex", apiKey: "key" }).id).toBe("openai-codex");
    expect(createProvider({ provider: "google-gemini", model: "gemini", apiKey: "key" }).id).toBe("google-gemini");
    expect(createProvider({ provider: "anthropic-claude", model: "claude", apiKey: "key" }).id).toBe("anthropic-claude");
  });
});
