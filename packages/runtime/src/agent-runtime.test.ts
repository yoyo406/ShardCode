import { describe, expect, it } from "vitest";
import type {
  ModelMessage,
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

class ScriptedModel implements ModelProvider {
  readonly id = "scripted";
  readonly model = "test-model";
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(private readonly responses: ModelResponse[]) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push({ ...request, messages: [...request.messages] });
    const response = this.responses[this.index];
    this.index += 1;
    if (!response) throw new Error("scripted response exhausted");
    return response;
  }
}

class ScriptedTools implements ToolInvoker {
  readonly calls: ToolCall[] = [];
  constructor(private readonly results: ToolResult[]) {}
  definitions(): ToolDefinition[] {
    return [{ name: "run_shell", description: "run", risk: "shell", inputSchema: { type: "object" } }];
  }
  async execute(call: ToolCall): Promise<ToolResult> {
    this.calls.push(call);
    return this.results[this.calls.length - 1] ?? {
      callId: call.id,
      toolName: call.name,
      status: "failed",
      output: "unexpected tool call",
      error: { code: "UNEXPECTED", message: "unexpected tool call" }
    };
  }
}

function response(content: string, toolCalls: ModelResponse["toolCalls"] = []): ModelResponse {
  return {
    message: { role: "assistant", content, ...(toolCalls.length ? { toolCalls } : {}) },
    toolCalls,
    finishReason: toolCalls.length ? "tool_call" : "stop",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
  };
}

function shellCall(id: string, command = "pnpm test"): ModelResponse["toolCalls"][number] {
  return { id, name: "run_shell", arguments: { command } };
}

function toolResult(callId: string, status: ToolResult["status"], output: string, code = "COMMAND_FAILED"): ToolResult {
  return {
    callId,
    toolName: "run_shell",
    status,
    output,
    ...(status === "completed" ? {} : { error: { code, message: output } }),
    ...(status === "failed" ? { exitCode: 2 } : {})
  };
}

describe("agent runtime", () => {
  it("runs tools and completes only after a successful validation plus marker", async () => {
    const model = new ScriptedModel([
      response("Running the checks.", [shellCall("call-1")]),
      response("SHARDCODE_VALIDATED: tests passed")
    ]);
    const tools = new ScriptedTools([toolResult("call-1", "completed", "all tests passed", "" )]);
    const store = new InMemorySessionStore();
    const runtime = new AgentRuntime({
      provider: model,
      tools,
      sessionStore: store,
      workspaceRoot: "/repo",
      budget: { maxTokens: 100, maxToolCalls: 4, maxWallClockSeconds: 60 }
    });

    const session = await runtime.run("Add tests");

    expect(session.status).toBe("completed");
    expect(session.rootTask.status).toBe("completed");
    expect(session.finalMessage).toContain("SHARDCODE_VALIDATED");
    expect(tools.calls).toHaveLength(1);
    const eventTypes = (await store.events(session.id)).map((event) => event.type);
    expect(eventTypes).toContain("ValidationPassed");
    expect(eventTypes).toContain("SessionCompleted");
  });

  it("returns a failed tool as an observation without retrying it", async () => {
    const model = new ScriptedModel([
      response("Trying the check.", [shellCall("call-1")]),
      response("SHARDCODE_VALIDATED: the failure is understood")
    ]);
    const tools = new ScriptedTools([toolResult("call-1", "failed", "tests failed")]);
    const runtime = new AgentRuntime({
      provider: model,
      tools,
      sessionStore: new InMemorySessionStore(),
      workspaceRoot: "/repo",
      budget: { maxTokens: 100, maxToolCalls: 4, maxWallClockSeconds: 60 }
    });

    const session = await runtime.run("Run tests");

    expect(tools.calls).toHaveLength(1);
    expect(model.requests[1]?.messages.at(-1)).toMatchObject({ role: "tool", content: "tests failed" });
    expect(session.status).toBe("failed");
  });

  it("aborts when the tool-call budget is exceeded", async () => {
    const model = new ScriptedModel([
      response("one", [shellCall("call-1")]),
      response("two", [shellCall("call-2")])
    ]);
    const tools = new ScriptedTools([toolResult("call-1", "completed", "ok")]);
    const store = new InMemorySessionStore();
    const runtime = new AgentRuntime({
      provider: model,
      tools,
      sessionStore: store,
      workspaceRoot: "/repo",
      budget: { maxTokens: 100, maxToolCalls: 1, maxWallClockSeconds: 60 }
    });

    const session = await runtime.run("Loop");

    expect(session.status).toBe("aborted");
    expect(session.rootTask.error).toContain("tool-call budget");
    expect((await store.events(session.id)).map((event) => event.type)).toContain("BudgetExceeded");
  });

  it("aborts after repeated equivalent failed observations", async () => {
    const model = new ScriptedModel([
      response("one", [shellCall("call-1")]),
      response("two", [shellCall("call-2")]),
      response("three", [shellCall("call-3")]),
      response("four", [shellCall("call-4")])
    ]);
    const tools = new ScriptedTools([
      toolResult("call-1", "failed", "same stack trace"),
      toolResult("call-2", "failed", "same stack trace"),
      toolResult("call-3", "failed", "same stack trace")
    ]);
    const store = new InMemorySessionStore();
    const runtime = new AgentRuntime({
      provider: model,
      tools,
      sessionStore: store,
      workspaceRoot: "/repo",
      budget: { maxTokens: 100, maxToolCalls: 10, maxWallClockSeconds: 60 },
      thrashingThreshold: 3
    });

    const session = await runtime.run("Fix the failing test");

    expect(session.status).toBe("aborted");
    expect((await store.events(session.id)).map((event) => event.type)).toContain("ThrashingDetected");
  });

  it("can resume a persisted non-terminal session", async () => {
    const store = new InMemorySessionStore();
    const model = new ScriptedModel([response("SHARDCODE_VALIDATED: resumed after inspection")]);
    const tools = new ScriptedTools([]);
    const firstRuntime = new AgentRuntime({
      provider: new ScriptedModel([response("paused", [shellCall("call-1")])]),
      tools: new ScriptedTools([toolResult("call-1", "completed", "checks passed")]),
      sessionStore: store,
      workspaceRoot: "/repo",
      budget: { maxTokens: 100, maxToolCalls: 4, maxWallClockSeconds: 60 }
    });
    const first = await firstRuntime.run("Resume me");
    first.status = "aborted";
    first.rootTask.status = "running";
    first.budget.maxToolCalls = 5;
    await store.save(first);

    const resumed = await new AgentRuntime({
      provider: model,
      tools,
      sessionStore: store,
      workspaceRoot: "/repo",
      budget: { maxTokens: 100, maxToolCalls: 5, maxWallClockSeconds: 60 }
    }).resume(first.id);

    expect(resumed.status).toBe("completed");
  });

  it("does not accept an unrelated successful shell command as validation", async () => {
    const model = new ScriptedModel([
      response("Running an unrelated command.", [shellCall("call-1", "echo ok")]),
      response("SHARDCODE_VALIDATED: premature"),
      response("Running the real check.", [shellCall("call-2", "pnpm test")]),
      response("SHARDCODE_VALIDATED: tests passed")
    ]);
    const tools = new ScriptedTools([
      toolResult("call-1", "completed", "ok"),
      toolResult("call-2", "completed", "33 tests passed")
    ]);
    const runtime = new AgentRuntime({
      provider: model,
      tools,
      sessionStore: new InMemorySessionStore(),
      workspaceRoot: "/repo",
      budget: { maxTokens: 100, maxToolCalls: 4, maxWallClockSeconds: 60 }
    });

    const session = await runtime.run("Validate the change");

    expect(session.status).toBe("completed");
    expect(session.rootTask.validation?.passedCommands).toEqual(["pnpm test"]);
  });
});
