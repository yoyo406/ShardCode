import { describe, expect, it } from "vitest";
import { runCli, writeFinalMessage, type CliIO } from "./main.js";
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

function tuiTerminal(inputs: string[]): TuiTerminal & { output: string[]; finished: number[]; closed: number } {
  const value = {
    isTTY: true,
    output: [] as string[],
    finished: [] as number[],
    closed: 0,
    open: async () => undefined,
    question: async () => inputs.shift() ?? "/exit",
    confirm: async () => true,
    write: (line: string) => value.output.push(line),
    error: (line: string) => value.output.push(line),
    clear: () => undefined,
    setStatus: () => undefined,
    finish: (exitCode: number) => value.finished.push(exitCode),
    close: () => { value.closed += 1; }
  };
  return value;
}

describe("CLI lifecycle", () => {
  it("runs a scripted provider without a network request", async () => {
    const testIo = io();
    const exitCode = await runCli(["run", "Run the checks", "--provider", "scripted", "--permission-mode", "acceptEdits"], testIo);

    expect(exitCode).toBe(0);
    expect(testIo.output.some((line) => line.includes("[session] completed"))).toBe(true);
    expect(testIo.output.some((line) => line.includes("completed"))).toBe(true);
  });

  it("runs the scripted lifecycle through the themed interactive TUI", async () => {
    const testIo = io();
    const terminal = tuiTerminal(["Run the checks", "/status", "/exit"]);
    testIo.tui = terminal;

    const exitCode = await runCli(["--provider", "scripted", "--permission-mode", "acceptEdits"], testIo);

    expect(exitCode).toBe(0);
    expect(terminal.output.some((line) => line.includes("Session"))).toBe(true);
    expect(terminal.output.some((line) => line.includes("Last session"))).toBe(true);
    expect(terminal.finished).toEqual([0]);
    expect(terminal.closed).toBe(1);
  });

  it("rejects JSON output in interactive mode", async () => {
    const testIo = io();

    expect(await runCli(["--json"], testIo)).toBe(2);
    expect(testIo.errors.join("\n")).toContain("--json");
  });

  it("returns a usage error for an incomplete resume command", async () => {
    const testIo = io();
    const exitCode = await runCli(["resume"], testIo);

    expect(exitCode).toBe(2);
    expect(testIo.errors.join("\n")).toContain("session id");
  });

  it("sanitizes final model output at the human output sink", () => {
    const testIo = io();

    writeFinalMessage(testIo, "\u009d8;window title\u009c\u001b[31mfinal\u001b[0m", false);

    expect(testIo.output).toEqual(["final"]);
  });

  it("does not write the final model output in JSON mode", () => {
    const testIo = io();

    writeFinalMessage(testIo, "\u001b[31mfinal\u001b[0m", true);

    expect(testIo.output).toEqual([]);
  });
});
