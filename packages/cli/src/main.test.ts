import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { JsonSessionStore } from "@shardcode/runtime";
import { FileStorage } from "@shardcode/tool-runtime";
import { runCli, type CliIO } from "./main.js";
import type { TuiTerminal } from "./tui.js";

function io(overrides: Partial<Pick<CliIO, "cwd" | "env">> = {}): CliIO & { output: string[]; errors: string[] } {
  const value = {
    output: [] as string[],
    errors: [] as string[],
    write: (line: string) => value.output.push(line),
    error: (line: string) => value.errors.push(line),
    ask: async () => true,
    cwd: overrides.cwd ?? process.cwd(),
    env: overrides.env ?? {}
  };
  return value;
}

function tuiTerminal(answers: string[]): TuiTerminal & {
  output: string[];
  errors: string[];
  finished: number[];
  statuses: string[];
  clearCount: number;
  closed: number;
} {
  const state = {
    output: [] as string[],
    errors: [] as string[],
    finished: [] as number[],
    statuses: [] as string[],
    clearCount: 0,
    closed: 0
  };
  return {
    isTTY: true,
    output: state.output,
    errors: state.errors,
    finished: state.finished,
    statuses: state.statuses,
    get clearCount() { return state.clearCount; },
    get closed() { return state.closed; },
    open: () => undefined,
    question: async () => answers.shift() ?? "/exit",
    confirm: async () => true,
    write: (line) => { state.output.push(line); },
    error: (line) => { state.errors.push(line); },
    clear: () => { state.clearCount += 1; },
    setStatus: (status) => { state.statuses.push(status); },
    finish: (exitCode) => { state.finished.push(exitCode); },
    close: () => { state.closed += 1; }
  };
}

describe("CLI lifecycle", () => {
  it("runs a scripted provider without a network request", async () => {
    const testIo = io();
    const exitCode = await runCli(["run", "Run the checks", "--provider", "scripted", "--permission-mode", "bypass", "--isolated-environment"], testIo);

    expect(exitCode).toBe(0);
    expect(testIo.output.some((line) => line.includes("[session] completed"))).toBe(true);
    expect(testIo.output.some((line) => line.includes("completed"))).toBe(true);
  });

  it("returns a usage error for an incomplete resume command", async () => {
    const testIo = io();
    const exitCode = await runCli(["resume"], testIo);

    expect(exitCode).toBe(2);
    expect(testIo.errors.join("\n")).toContain("session id");
  });

  it("uses pnpm's invocation root instead of the CLI package directory", async () => {
    const repositoryRoot = process.cwd();
    const testIo = io({
      cwd: join(repositoryRoot, "packages/cli"),
      env: { INIT_CWD: repositoryRoot }
    });

    const exitCode = await runCli(["run", "Use the repository root", "--provider", "scripted", "--permission-mode", "bypass", "--isolated-environment"], testIo);

    expect(exitCode).toBe(0);
    const sessionId = testIo.output.find((line) => line.startsWith("[session] started "))?.split(" ").at(-1);
    expect(sessionId).toBeTruthy();
    const session = await new JsonSessionStore(new FileStorage(join(repositoryRoot, ".shardcode"))).load(sessionId ?? "");
    expect(session?.workspaceRoot).toBe(repositoryRoot);
  });

  it("runs the interactive TUI through the scripted runtime lifecycle", async () => {
    const testIo = io();
    const terminal = tuiTerminal(["Run the checks", "/status", "/exit"]);
    testIo.tui = terminal;

    const exitCode = await runCli([
      "--provider",
      "scripted",
      "--permission-mode",
      "bypass",
      "--isolated-environment"
    ], testIo);

    expect(exitCode).toBe(0);
    expect(terminal.output.some((line) => line.includes("[session] completed"))).toBe(true);
    expect(terminal.output.some((line) => line.includes("Last session:"))).toBe(true);
    expect(terminal.finished).toEqual([0]);
    expect(terminal.closed).toBe(1);
  });

  it("handles slash commands locally without creating a second runtime task", async () => {
    const testIo = io();
    const terminal = tuiTerminal(["/model", "/permissions", "/help status", "/exit"]);
    testIo.tui = terminal;

    const exitCode = await runCli([
      "--provider",
      "scripted",
      "--permission-mode",
      "acceptEdits"
    ], testIo);

    expect(exitCode).toBe(0);
    expect(terminal.output.some((line) => line.includes("Provider: scripted"))).toBe(true);
    expect(terminal.output.some((line) => line.includes("Permission mode: acceptEdits"))).toBe(true);
    expect(terminal.output.some((line) => line.includes("/status"))).toBe(true);
    expect(terminal.finished).toEqual([0]);
  });
});
