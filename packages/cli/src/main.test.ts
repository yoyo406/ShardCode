import { describe, expect, it } from "vitest";
import { runCli, type CliIO } from "./main.js";
import type { TuiTerminal } from "./tui.js";

function io(): CliIO & { output: string[]; errors: string[] } {
  const value = {
    output: [] as string[],
    errors: [] as string[],
    write: (line: string) => value.output.push(line),
    error: (line: string) => value.errors.push(line),
    ask: async () => true,
    cwd: process.cwd(),
    env: {}
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
    const exitCode = await runCli(["run", "Run the checks", "--provider", "scripted", "--permission-mode", "acceptEdits"], testIo);

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

  it("runs the interactive TUI through the scripted runtime lifecycle", async () => {
    const testIo = io();
    const terminal = tuiTerminal(["Run the checks", "/status", "/exit"]);
    testIo.tui = terminal;

    const exitCode = await runCli([
      "--provider",
      "scripted",
      "--permission-mode",
      "acceptEdits"
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
