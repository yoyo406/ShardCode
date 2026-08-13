import { describe, expect, it } from "vitest";
import { discoverModels, getProviderDefinition } from "./discovery.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("provider model discovery", () => {
  it("discovers OpenAI models with bearer authentication", async () => {
    let request: { url: string; headers: Headers } | undefined;
    const result = await discoverModels("openai", "openai-key", {
      fetch: async (input, init) => {
        request = { url: String(input), headers: new Headers(init?.headers) };
        return jsonResponse({ data: [{ id: "gpt-5.4" }, { id: "o4-mini" }] });
      }
    });

    expect(request?.url).toBe("https://api.openai.com/v1/models");
    expect(request?.headers.get("authorization")).toBe("Bearer openai-key");
    expect(result.verification).toBe("verified");
    expect(result.models.map((model) => model.id)).toEqual(["gpt-5.4", "o4-mini"]);
    expect(result.models[0]).toMatchObject({
      providerId: "openai",
      protocol: "openai-chat",
      baseUrl: "https://api.openai.com/v1/chat/completions"
    });
  });

  it("uses the Codex model filter and Responses endpoint", async () => {
    const result = await discoverModels("openai-codex", "codex-key", {
      fetch: async () =>
        jsonResponse({
          data: [{ id: "gpt-5.4-codex" }, { id: "gpt-5.4" }, { id: "codex-mini-latest" }]
        })
    });

    expect(result.models.map((model) => model.id)).toEqual(["gpt-5.4-codex", "codex-mini-latest"]);
    expect(result.models.every((model) => model.protocol === "openai-responses")).toBe(true);
    expect(result.models[0]?.baseUrl).toBe("https://api.openai.com/v1/responses");
  });

  it("discovers Gemini models with the current API-key header", async () => {
    let headers: Headers | undefined;
    const result = await discoverModels("google-gemini", "gemini-key", {
      fetch: async (_input, init) => {
        headers = new Headers(init?.headers);
        return jsonResponse({
          models: [
            { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
            { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }
          ]
        });
      }
    });

    expect(headers?.get("x-goog-api-key")).toBe("gemini-key");
    expect(headers?.get("authorization")).toBeNull();
    expect(result.models).toEqual([
      expect.objectContaining({ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", protocol: "gemini" }),
      expect.objectContaining({ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", protocol: "gemini" })
    ]);
  });

  it("discovers Mistral and Anthropic models with provider-specific headers", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, headers: new Headers(init?.headers) });
      if (url.includes("mistral.ai")) return jsonResponse({ data: [{ id: "mistral-large-latest" }] });
      return jsonResponse({ data: [{ id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" }] });
    };

    const mistral = await discoverModels("mistral", "mistral-key", { fetch });
    const anthropic = await discoverModels("anthropic-claude", "anthropic-key", { fetch });

    expect(requests[0]).toMatchObject({ url: "https://api.mistral.ai/v1/models" });
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer mistral-key");
    expect(requests[1]).toMatchObject({ url: "https://api.anthropic.com/v1/models" });
    expect(requests[1]?.headers.get("x-api-key")).toBe("anthropic-key");
    expect(requests[1]?.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(mistral.models[0]?.baseUrl).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(anthropic.models[0]).toMatchObject({
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1/messages"
    });
  });

  it("follows Anthropic pagination", async () => {
    const urls: string[] = [];
    const result = await discoverModels("anthropic-claude", "anthropic-key", {
      fetch: async (input) => {
        const url = String(input);
        urls.push(url);
        return urls.length === 1
          ? jsonResponse({ data: [{ id: "claude-first" }], has_more: true, last_id: "claude-first" })
          : jsonResponse({ data: [{ id: "claude-second" }], has_more: false });
      }
    });

    expect(urls).toEqual([
      "https://api.anthropic.com/v1/models",
      "https://api.anthropic.com/v1/models?after_id=claude-first"
    ]);
    expect(result.models.map((model) => model.id)).toEqual(["claude-first", "claude-second"]);
  });

  it("discovers OpenCode Zen and Go models with routed endpoints", async () => {
    const zen = await discoverModels("opencode-zen", "zen-key", {
      fetch: async () => jsonResponse({ data: [{ id: "gpt-5.4" }, { id: "claude-sonnet-4-6" }] })
    });
    const go = await discoverModels("opencode-go", "go-key", {
      fetch: async () => jsonResponse({ models: [{ id: "kimi-k2.5" }, { id: "gpt-5.4" }] })
    });

    expect(zen.models).toEqual([
      expect.objectContaining({ baseUrl: "https://opencode.ai/zen/v1/responses", protocol: "openai-responses" }),
      expect.objectContaining({ baseUrl: "https://opencode.ai/zen/v1/messages", protocol: "anthropic" })
    ]);
    expect(go.models).toEqual([
      expect.objectContaining({ baseUrl: "https://opencode.ai/zen/go/v1/chat/completions", protocol: "openai-chat" }),
      expect.objectContaining({ baseUrl: "https://opencode.ai/zen/go/v1/responses", protocol: "openai-responses" })
    ]);
  });

  it("returns the Cline catalog without claiming key verification", async () => {
    let called = false;
    const result = await discoverModels("cline", "cline-key", {
      fetch: async () => {
        called = true;
        return jsonResponse({});
      }
    });

    expect(called).toBe(false);
    expect(result.verification).toBe("unverified");
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.models.every((model) => model.id.includes("/") && model.protocol === "openai-chat")).toBe(true);
  });

  it("reads the Kilo catalog without sending the API key and marks it unverified", async () => {
    let request: { url: string; headers: Headers } | undefined;
    const result = await discoverModels("kilo-code", "kilo-secret", {
      fetch: async (input, init) => {
        request = { url: String(input), headers: new Headers(init?.headers) };
        return jsonResponse({ data: [{ id: "anthropic/claude-sonnet-4-5" }] });
      }
    });

    expect(request?.url).toBe("https://api.kilo.ai/api/gateway/models");
    expect(request?.headers.get("authorization")).toBeNull();
    expect(result.verification).toBe("unverified");
    expect(result.models[0]).toMatchObject({
      id: "anthropic/claude-sonnet-4-5",
      baseUrl: "https://api.kilo.ai/api/gateway/chat/completions",
      protocol: "gateway"
    });
  });

  it("exposes human-readable definitions for the connect menu", () => {
    expect(getProviderDefinition("openai")).toMatchObject({ label: "OpenAI", protocol: "openai-chat" });
    expect(getProviderDefinition("kilo-code")).toMatchObject({ label: "Kilo-code (api key)", protocol: "gateway" });
  });
});
