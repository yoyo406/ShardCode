import { describe, expect, it } from "vitest";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ToolCall,
  ToolDefinition,
  ToolInvoker,
  ToolResult
} from "@shardcode/shared";
import { AgentRuntime } from "./agent-runtime.js";
import { InMemorySessionStore } from "./session.js";

function response(content: string, toolCalls: ModelResponse["toolCalls"] = []): ModelResponse {
  return {
    message: { role: "assistant", content, ...(toolCalls.length > 0 ? { toolCalls } : {}) },
    toolCalls,
    finishReason: toolCalls.length > 0 ? "tool_call" : "stop"
  };
}

function call(id: string, name: string, input: unknown): ModelResponse["toolCalls"][number] {
  return { id, name, arguments: input };
}

class SequenceProvider implements ModelProvider {
  readonly id = "scripted";
  readonly model = "test-model";
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(private readonly responses: ModelResponse[]) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const next = this.responses[this.index++];
    if (!next) throw new Error("response sequence exhausted");
    return next;
  }
}

class ParallelTools implements ToolInvoker {
  private active = 0;
  maxActive = 0;

  definitions(): ToolDefinition[] {
    return [
      { name: "read_file", description: "read", risk: "read", executionMode: "parallel", inputSchema: { type: "object" } },
      { name: "run_shell", description: "check", risk: "shell", executionMode: "sequential", inputSchema: { type: "object" } }
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    this.active -= 1;
    return {
      callId: call.id,
      toolName: call.name,
      status: "completed",
      output: call.name === "run_shell" ? "checks passed" : call.id
    };
  }
}

describe("Pi-inspired runtime controls", () => {
  it("executes independent read tools concurrently but preserves their result order", async () => {
    const provider = new SequenceProvider([
      response("inspect", [call("read-1", "read_file", { path: "a.ts" }), call("read-2", "read_file", { path: "b.ts" })]),
      response("validate", [call("check-1", "run_shell", { command: "pnpm test" })]),
      response("SHARDCODE_VALIDATED: checks passed")
    ]);
    const tools = new ParallelTools();
    const session = await new AgentRuntime({
      provider,
      tools,
      sessionStore: new InMemorySessionStore(),
      workspaceRoot: "/repo",
      budget: { maxTokens: 1_000, maxToolCalls: 5, maxWallClockSeconds: 60 }
    }).run("Inspect and validate");

    expect(session.status).toBe("completed");
    expect(tools.maxActive).toBe(2);
    const toolMessages = session.messages.filter((message) => message.role === "tool");
    expect(toolMessages.map((message) => message.content)).toEqual(["read-1", "read-2", "checks passed"]);
  });

  it("propagates abort to the provider and persists an aborted session", async () => {
    let receivedSignal: AbortSignal | undefined;
    const provider: ModelProvider = {
      id: "blocking",
      model: "blocking-model",
      complete: async (request) => {
        receivedSignal = request.signal;
        return new Promise<ModelResponse>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(new Error("provider stopped")), { once: true });
        });
      }
    };
    const runtime = new AgentRuntime({
      provider,
      tools: new ParallelTools(),
      sessionStore: new InMemorySessionStore(),
      workspaceRoot: "/repo",
      budget: { maxTokens: 1_000, maxToolCalls: 5, maxWallClockSeconds: 60 }
    });

    const running = runtime.run("Stop this task");
    await new Promise((resolve) => setTimeout(resolve, 10));
    runtime.abort();
    const session = await running;

    expect(receivedSignal?.aborted).toBe(true);
    expect(session.status).toBe("aborted");
    expect(session.rootTask.error).toContain("provider");
  });

  it("supports pre-execution blocking and post-execution result normalization", async () => {
    const provider = new SequenceProvider([
      response("inspect and check", [call("read-1", "read_file", { path: "secret.txt" }), call("check-1", "run_shell", { command: "pnpm test" })]),
      response("SHARDCODE_VALIDATED: checks passed")
    ]);
    const tools = new ParallelTools();
    const store = new InMemorySessionStore();
    const session = await new AgentRuntime({
      provider,
      tools,
      sessionStore: store,
      workspaceRoot: "/repo",
      budget: { maxTokens: 1_000, maxToolCalls: 5, maxWallClockSeconds: 60 },
      beforeToolCall: async ({ call: toolCall }) => toolCall.name === "read_file" ? { block: true, reason: "protected by extension" } : undefined,
      afterToolCall: async ({ result }) => result.toolName === "run_shell" ? { ...result, output: "normalized checks" } : undefined
    }).run("Inspect and validate");

    expect(session.status).toBe("completed");
    expect(session.messages.filter((message) => message.role === "tool").map((message) => message.content)).toEqual([
      "protected by extension",
      "normalized checks"
    ]);
    expect((await store.events(session.id)).map((event) => event.type)).toContain("ToolDenied");
  });
});
