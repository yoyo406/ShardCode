import { describe, expect, it } from "vitest";
import { HELP_TEXT, parseArgs } from "./args.js";

describe("CLI arguments", () => {
  it("opens interactive mode when no command is provided", () => {
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

  it("parses execution and context controls", () => {
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
      "--max-context-characters",
      "64000",
      "--json"
    ])).toMatchObject({
      command: "run",
      prompt: "Implement OAuth",
      provider: "anthropic",
      model: "claude-test",
      permissionMode: "acceptEdits",
      maxToolCalls: 12,
      maxContextCharacters: 64_000,
      json: true
    });
  });

  it("requires exactly one resume id and rejects unknown options", () => {
    expect(() => parseArgs(["resume", "session-123", "extra"])).toThrow("session id");
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

  it("documents interactive, direct, provider, and context usage", () => {
    expect(HELP_TEXT).toContain("shard [options]");
    expect(HELP_TEXT).toContain("shardcode [options]");
    expect(HELP_TEXT).toContain('shardcode "task description" [options]');
    expect(HELP_TEXT).toContain("shardcode run");
    expect(HELP_TEXT).toContain("shardcode resume");
    expect(HELP_TEXT).toContain("interactive TUI");
    expect(HELP_TEXT).toContain("openai-codex");
    expect(HELP_TEXT).toContain("kilo-code");
    expect(HELP_TEXT).toContain("--max-context-characters");
  });
});
