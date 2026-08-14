import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("streams interactive events and the running footer before a pending approval resolves", async () => {
    const testIo = io();
    const terminal = tuiTerminal(["Run the checks", "/exit"]);
    testIo.tui = terminal;
    let approve: (() => void) | undefined;
    let asked: (() => void) | undefined;
    terminal.confirm = async () => {
      asked?.();
      await new Promise<void>((resolve) => { approve = resolve; });
      return true;
    };

    const run = runCli(["--provider", "scripted", "--permission-mode", "acceptEdits"], testIo);
    await new Promise<void>((resolve) => { asked = resolve; });

    expect(terminal.output.some((line) => line.includes("[session] started"))).toBe(true);
    expect(terminal.output.some((line) => line.includes("Status:") && line.includes("running"))).toBe(true);

    approve?.();
    await expect(run).resolves.toBe(0);
  });

  it("uses the saved session provider and model in the resumed TUI snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "shardcode-cli-resume-"));
    const sessionId = "11111111-1111-4111-8111-111111111111";
    await mkdir(join(root, ".shardcode", "sessions"), { recursive: true });
    await writeFile(join(root, ".shardcode", "sessions", `${sessionId}.json`), JSON.stringify({
      id: sessionId,
      provider: "anthropic",
      model: "saved-model",
      status: "completed"
    }));
    const testIo = io();
    testIo.cwd = root;
    testIo.env = { ANTHROPIC_API_KEY: "test-key" };
    const terminal = tuiTerminal([`/resume ${sessionId}`, "/model", "/status", "/exit"]);
    testIo.tui = terminal;

    await expect(runCli([], testIo)).resolves.toBe(0);

    const output = terminal.output.join("\n");
    expect(output).toContain("Model: anthropic / saved-model");
    expect(output).toContain("Status: completed");
  });

  it("sanitizes direct permission questions while preserving the raw authorization request", async () => {
    const root = await mkdtemp(join(tmpdir(), "shardcode-cli-permission-"));
    await mkdir(join(root, ".shardcode"), { recursive: true });
    await writeFile(join(root, ".shardcode", "settings.json"), JSON.stringify({
      rules: [{
        tool: "run_shell",
        command: "*",
        decision: "ask",
        reason: "review\u001b[2J\r\n\tthis command"
      }]
    }));
    const testIo = io();
    testIo.cwd = root;
    let question = "";
    let rawCommand = "";
    testIo.ask = async (value, request) => {
      question = value;
      rawCommand = request?.command ?? "";
      return true;
    };

    await expect(runCli(["run", "Run the checks", "--provider", "scripted", "--permission-mode", "acceptEdits"], testIo)).resolves.toBe(0);

    expect(question).toContain("run_shell:");
    expect(question).toContain("reviewthis command");
    expect(question).not.toMatch(/[\u001b\r\n\t]/);
    expect(rawCommand).toBe("node -e \"console.log('scripted check')\"");
  });

  it("keeps interactive settings truthful when slash commands request changes", async () => {
    const testIo = io();
    const terminal = tuiTerminal(["/permissions ask", "/model alternate", "/status", "/exit"]);
    testIo.tui = terminal;

    const exitCode = await runCli([
      "--provider", "scripted",
      "--permission-mode", "bypass",
      "--isolated-environment"
    ], testIo);

    const output = terminal.output.join("\n");
    expect(exitCode).toBe(0);
    expect(output).toContain("Permissions remain bypass");
    expect(output).not.toContain("Permissions: ask");
    expect(output).toContain("Model remains scripted / scripted-local");
    expect(output).not.toContain("alternate");
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

  it("sanitizes control-bearing parse errors before the direct error sink", async () => {
    const testIo = io();
    const hostile = "\u001b[2J\u001b]8;;https://evil\u0007\u009b31m\r";

    await expect(runCli(["run", "Run the checks", "--provider", hostile], testIo)).resolves.toBe(2);

    expect(testIo.errors).toHaveLength(1);
    expect(testIo.errors[0]).not.toMatch(/[\u001b\u0080-\u009f\r]/);
  });

  it("sanitizes control-bearing runtime errors before the direct error sink", async () => {
    const testIo = io();
    const hostile = "missing\u001b[2J\u001b]8;;https://evil\u0007\u009b31m\r";

    await expect(runCli(["resume", hostile, "--provider", "scripted"], testIo)).resolves.toBe(1);

    expect(testIo.errors).toHaveLength(1);
    expect(testIo.errors[0]).not.toMatch(/[\u001b\u0080-\u009f\r]/);
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
