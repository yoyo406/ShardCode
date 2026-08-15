import { describe, expect, it } from "vitest";
import { HELP_TEXT, parseArgs } from "./args.js";

describe("CLI arguments", () => {
  it("parses a run task and execution controls", () => {
    expect(parseArgs([
      "run",
      "Implement OAuth",
      "--provider",
      "anthropic",
      "--model",
      "claude-test",
      "--permission-mode",
      "acceptEdits",
      "--max-tool-calls",
      "12",
      "--json"
    ])).toMatchObject({
      command: "run",
      prompt: "Implement OAuth",
      provider: "anthropic",
      model: "claude-test",
      permissionMode: "acceptEdits",
      maxToolCalls: 12,
      json: true
    });
  });

  it("parses resume and rejects unknown options", () => {
    expect(parseArgs(["resume", "session-123"])).toMatchObject({ command: "resume", sessionId: "session-123" });
    expect(() => parseArgs(["run", "task", "--not-real"])).toThrow("unknown option");
  });

  it("opens the interactive mode with no explicit command", () => {
    expect(parseArgs([])).toMatchObject({ command: "interactive", provider: "openai" });
    expect(parseArgs(["--provider", "scripted"])).toMatchObject({
      command: "interactive",
      provider: "scripted"
    });
  });

  it("recognizes short help after options", () => {
    expect(parseArgs(["--provider", "scripted", "-h"])).toMatchObject({
      command: "help",
      provider: "scripted"
    });
  });

  it("accepts a bare task while preserving explicit commands", () => {
    expect(parseArgs(["Fix the tests", "--provider", "scripted"])).toMatchObject({
      command: "run",
      prompt: "Fix the tests",
      provider: "scripted"
    });
    expect(parseArgs(["run", "Fix the tests"])).toMatchObject({ command: "run", prompt: "Fix the tests" });
    expect(parseArgs(["resume", "session-123"])).toMatchObject({ command: "resume", sessionId: "session-123" });
  });

  it("documents the no-argument interactive mode in help", () => {
    expect(HELP_TEXT).toContain("shard [options]");
    expect(HELP_TEXT).toContain("shardcode [options]");
    expect(HELP_TEXT).toContain('shardcode "task description" [options]');
    expect(HELP_TEXT).toContain("interactive TUI");
  });
});
