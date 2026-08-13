import { describe, expect, it } from "vitest";
import { HELP_TEXT, parseArgs } from "./args.js";

describe("CLI arguments", () => {
  it("opens interactive mode when no command is provided", () => {
    expect(parseArgs([])).toMatchObject({ command: "interactive", provider: "openai" });
  });

  it("accepts a bare task as a direct run command", () => {
    expect(parseArgs(["Fix the tests", "--provider", "scripted"])).toMatchObject({
      command: "run",
      prompt: "Fix the tests",
      provider: "scripted"
    });
  });

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

  it("accepts every connectable provider from the command line", () => {
    for (const provider of [
      "openai",
      "openai-codex",
      "google-gemini",
      "mistral",
      "anthropic-claude",
      "opencode-zen",
      "opencode-go",
      "cline",
      "kilo-code"
    ]) {
      expect(parseArgs(["run", "task", "--provider", provider])).toMatchObject({ provider, providerExplicit: true });
    }
  });

  it("documents interactive and direct launcher usage", () => {
    expect(HELP_TEXT).toContain("shard \"task description\"");
    expect(HELP_TEXT).toContain("shardcode run");
    expect(HELP_TEXT).toContain("shardcode resume");
    expect(HELP_TEXT).toContain("openai-codex");
    expect(HELP_TEXT).toContain("kilo-code");
  });
});
