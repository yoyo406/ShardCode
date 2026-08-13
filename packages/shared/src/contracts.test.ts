import { describe, expect, it } from "vitest";
import type {
  ModelRequest,
  ModelResponse,
  Session,
  ToolCall,
  ToolResult
} from "./contracts.js";

describe("shared contracts", () => {
  it("describes a normalized tool call and result", () => {
    const call: ToolCall = {
      id: "call-1",
      name: "read_file",
      input: { path: "README.md" }
    };
    const result: ToolResult = {
      callId: call.id,
      toolName: call.name,
      status: "completed",
      output: "content"
    };

    expect(result).toMatchObject({ callId: "call-1", status: "completed" });
  });

  it("keeps model requests and sessions JSON serializable", () => {
    const request: ModelRequest = {
      model: "test-model",
      messages: [{ role: "user", content: "Inspect the repository" }],
      tools: []
    };
    const response: ModelResponse = {
      message: { role: "assistant", content: "I will inspect it." },
      toolCalls: [],
      finishReason: "stop"
    };
    const session: Session = {
      id: "session-1",
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
      workspaceRoot: "/repo",
      provider: "scripted",
      model: "test-model",
      rootTask: {
        id: "task-1",
        prompt: "Inspect the repository",
        status: "pending",
        subtasks: [],
        attempts: []
      },
      worktrees: [],
      budget: {
        maxTokens: 1000,
        maxToolCalls: 10,
        maxWallClockSeconds: 60,
        usedTokens: 0,
        usedToolCalls: 0
      },
      eventLogPath: ".shardcode/sessions/session-1.events.jsonl",
      status: "pending",
      messages: request.messages
    };

    expect(JSON.parse(JSON.stringify({ request, response, session }))).toEqual(
      expect.objectContaining({ request, response, session })
    );
  });
});
