import { describe, expect, it } from "vitest";
import type { ToolCall, ToolResult } from "@shardcode/shared";
import { ContextEngine } from "./context-engine.js";

describe("context engine", () => {
  it("delegates repository exploration to agentic tools", async () => {
    const calls: ToolCall[] = [];
    const engine = new ContextEngine({
      definitions: () => [],
      execute: async (call) => {
        calls.push(call);
        const result: ToolResult = {
          callId: call.id,
          toolName: call.name,
          status: "completed",
          output: call.name === "list_files" ? "src/index.ts" : "src/index.ts:1:export {};"
        };
        return result;
      }
    });

    const context = await engine.explore();

    expect(calls.map((call) => call.name)).toEqual(["list_files", "grep"]);
    expect(context.files).toEqual(["src/index.ts"]);
    expect(context.matches).toContain("src/index.ts:1:export {};");
  });
});
