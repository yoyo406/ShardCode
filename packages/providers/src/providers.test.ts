import { describe, expect, it } from "vitest";
import type { ModelRequest, ModelResponse } from "@shardcode/shared";
import { createProvider, createScriptedProvider } from "./index.js";

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
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"]
      }
    }
  ]
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("normalized providers", () => {
  it("normalizes an OpenAI tool call and sends the shared tool schema", async () => {
    let captured: { url: string; body: Record<string, unknown> } | undefined;
    const provider = createProvider({
      provider: "openai",
      model: request.model,
      apiKey: "test-key",
      fetch: async (input, init) => {
        captured = {
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        };
        return jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"README.md"}'
                    }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
        });
      }
    });

    const response = await provider.complete(request);

    expect(captured?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(captured?.body.tools).toEqual([
      {
        type: "function",
        function: expect.objectContaining({ name: "read_file" })
      }
    ]);
    expect(response.toolCalls).toEqual([
      { id: "call-1", name: "read_file", arguments: { path: "README.md" } }
    ]);
    expect(response.usage?.totalTokens).toBe(14);
    expect(response.finishReason).toBe("tool_call");
  });

  it("normalizes Anthropic text and tool-use blocks", async () => {
    let captured: Record<string, unknown> | undefined;
    const provider = createProvider({
      provider: "anthropic",
      model: request.model,
      apiKey: "test-key",
      fetch: async (_input, init) => {
        captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          content: [
            { type: "text", text: "I will read it." },
            { type: "tool_use", id: "tool-1", name: "read_file", input: { path: "README.md" } }
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 8, output_tokens: 6 }
        });
      }
    });

    const response = await provider.complete(request);

    expect(captured?.system).toBe("You are a coding agent.");
    expect(response.message.content).toBe("I will read it.");
    expect(response.toolCalls[0]).toEqual({
      id: "tool-1",
      name: "read_file",
      arguments: { path: "README.md" }
    });
    expect(response.usage?.totalTokens).toBe(14);
  });

  it("normalizes Gemini function calls", async () => {
    let captured: { url: string; headers: Headers } | undefined;
    const provider = createProvider({
      provider: "gemini",
      model: request.model,
      apiKey: "test-key",
      fetch: async (input, init) => {
        captured = { url: String(input), headers: new Headers(init?.headers) };
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  { text: "I will read it." },
                  { functionCall: { name: "read_file", args: { path: "README.md" } } }
                ]
              },
              finishReason: "STOP"
            }
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 }
        });
      }
    });

    const response = await provider.complete(request);

    expect(captured?.url).not.toContain("test-key");
    expect(captured?.headers.get("x-goog-api-key")).toBe("test-key");
    expect(response.message.content).toBe("I will read it.");
    expect(response.toolCalls[0]).toMatchObject({ name: "read_file", arguments: { path: "README.md" } });
    expect(response.usage?.totalTokens).toBe(12);
  });

  it("returns scripted responses in order for deterministic tests", async () => {
    const first: ModelResponse = {
      message: { role: "assistant", content: "first" },
      toolCalls: [],
      finishReason: "stop"
    };
    const second: ModelResponse = {
      message: { role: "assistant", content: "second" },
      toolCalls: [],
      finishReason: "stop"
    };
    const provider = createScriptedProvider("scripted-model", [first, second]);

    await expect(provider.complete(request)).resolves.toEqual(first);
    await expect(provider.complete(request)).resolves.toEqual(second);
  });
});
