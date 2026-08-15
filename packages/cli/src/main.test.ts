import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonSessionStore } from "@shardcode/runtime";
import { FileStorage } from "@shardcode/tool-runtime";
import { runCli, writeFinalMessage, type CliIO } from "./main.js";
import type { TuiTerminal } from "./tui.js";

function io(overrides: Partial<Pick<CliIO, "cwd" | "env" | "fetch">> = {}): CliIO & { output: string[]; errors: string[] } {
  const value = {
    output: [] as string[],
    errors: [] as string[],
    write: (line: string) => value.output.push(line),
    error: (line: string) => value.errors.push(line),
    ask: async () => true,
    cwd: overrides.cwd ?? process.cwd(),
    env: overrides.env ?? {}
    , ...(overrides.fetch ? { fetch: overrides.fetch } : {})
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
    select: async (_title, options) => {
      const index = Number(answers.shift());
      return Number.isInteger(index) && index >= 0 && index < options.length ? index : undefined;
    },
    secret: async () => answers.shift(),
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
    expect(testIo.output.some((line) => line.includes("Session terminée (réussie)"))).toBe(true);
    expect(testIo.output.some((line) => line.includes("completed"))).toBe(true);
  });

  it("runs the scripted lifecycle through the themed interactive TUI", async () => {
    const testIo = io();
    const terminal = tuiTerminal(["Run the checks", "/status", "/exit"]);
    testIo.tui = terminal;

    const exitCode = await runCli(["--provider", "scripted", "--permission-mode", "acceptEdits", "--isolated-environment"], testIo);

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

    const run = runCli(["--provider", "scripted", "--permission-mode", "acceptEdits", "--isolated-environment"], testIo);
    await new Promise<void>((resolve) => { asked = resolve; });

    expect(terminal.output.some((line) => line.includes("Session démarrée"))).toBe(true);
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
      status: "completed",
      rootTask: { prompt: "Saved task" },
      updatedAt: "2026-08-13T00:00:00.000Z"
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

  it("uses explicit provider and model overrides in the resumed TUI snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "shardcode-cli-resume-"));
    const sessionId = "22222222-2222-4222-8222-222222222222";
    await mkdir(join(root, ".shardcode", "sessions"), { recursive: true });
    await writeFile(join(root, ".shardcode", "sessions", `${sessionId}.json`), JSON.stringify({
      id: sessionId,
      provider: "anthropic",
      model: "saved-model",
      status: "completed",
      rootTask: { prompt: "Saved task" },
      updatedAt: "2026-08-13T00:00:00.000Z"
    }));
    const testIo = io();
    testIo.cwd = root;
    const terminal = tuiTerminal([`/resume ${sessionId}`, "/status", "/exit"]);
    testIo.tui = terminal;

    await expect(runCli(["--provider", "scripted", "--model", "explicit-model"], testIo)).resolves.toBe(0);

    const output = terminal.output.join("\n");
    expect(output).toContain("Model: scripted / explicit-model");
    expect(output).not.toContain("Model: anthropic / saved-model");
  });

  it("sanitizes direct permission questions while preserving the raw authorization request", async () => {
    const root = await mkdtemp(join(tmpdir(), "shardcode-cli-permission-"));
    await mkdir(join(root, ".shardcode"), { recursive: true });
    await mkdir(join(root, "packages", "cli", "dist"), { recursive: true });
    await writeFile(join(root, "packages", "cli", "dist", "index.js"), "export {};\n");
    await writeFile(join(root, ".shardcode", "settings.json"), JSON.stringify({
      rules: [{
        tool: "run_shell",
        command: "node --check packages/cli/dist/index.js",
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

    await expect(runCli(["run", "Run the checks", "--provider", "scripted", "--permission-mode", "acceptEdits", "--isolated-environment"], testIo)).resolves.toBe(0);

    expect(question).toContain("run_shell:");
    expect(question).toContain("node --check packages/cli/dist/index.js");
    expect(question).toContain("review⏎⇥this command");
    expect(question).not.toMatch(/[\u001b\r\n\t]/);
    expect(rawCommand).toBe("node --check packages/cli/dist/index.js");
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
    const hostile = "\u001b[2J\u001b]8;;https://evil\u0007\u009b31m\r\n\tparse details";

    await expect(runCli(["run", "Run the checks", "--provider", hostile], testIo)).resolves.toBe(2);

    expect(testIo.errors).toHaveLength(1);
    expect(testIo.errors[0]).toContain("unsupported provider:");
    expect(testIo.errors[0]).toContain("parse details");
    expect(testIo.errors[0]).not.toMatch(/[\u001b\u0080-\u009f\r\n\t]/);
  });

  it("sanitizes control-bearing runtime errors before the direct error sink", async () => {
    const testIo = io();
    const hostile = "missing\u001b[2J\u001b]8;;https://evil\u0007\u009b31m\r\n\truntime details";

    await expect(runCli(["resume", hostile, "--provider", "scripted"], testIo)).resolves.toBe(1);

    expect(testIo.errors).toHaveLength(1);
    expect(testIo.errors[0]).toContain("session not found:");
    expect(testIo.errors[0]).toContain("runtime details");
    expect(testIo.errors[0]).not.toMatch(/[\u001b\u0080-\u009f\r\n\t]/);
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

  it("uses pnpm's invocation root instead of the CLI package directory", async () => {
    const repositoryRoot = process.cwd();
    const testIo = io({
      cwd: join(repositoryRoot, "packages/cli"),
      env: { INIT_CWD: repositoryRoot }
    });
    const sessionsPath = join(repositoryRoot, ".shardcode", "sessions");
    const existingSessions = new Set((await readdir(sessionsPath).catch(() => [])).filter((name) => name.endsWith(".json")));

    const exitCode = await runCli(["run", "Use the repository root", "--provider", "scripted", "--permission-mode", "bypass", "--isolated-environment"], testIo);

    expect(exitCode).toBe(0);
    expect(testIo.output).toContain("Session démarrée");
    const sessionFile = (await readdir(sessionsPath)).find((name) => name.endsWith(".json") && !existingSessions.has(name));
    const sessionId = sessionFile?.slice(0, -".json".length);
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
    expect(terminal.output.some((line) => line.includes("Session terminée (réussie)"))).toBe(true);
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

  it("connects a provider, discovers its models, and uses the stored connection", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "shardcode-connect-test-"));
    const testIo = io({
      env: { SHARDCODE_CONFIG_HOME: configHome },
      fetch: async (_input, init) => {
        if (init?.method === "GET") {
          return new Response(JSON.stringify({ data: [{ id: "gpt-5.4", display_name: "GPT-5.4" }] }), { status: 200 });
        }
        const body = JSON.parse(String(init?.body)) as { messages?: Array<{ role?: string }> };
        const hasToolResult = body.messages?.some((message) => message.role === "tool");
        return new Response(JSON.stringify(hasToolResult
          ? { choices: [{ message: { role: "assistant", content: "SHARDCODE_VALIDATED: connected task complete" }, finish_reason: "stop" }] }
          : {
              choices: [{
                message: {
                  role: "assistant",
                  content: "Running validation.",
                  tool_calls: [{ id: "validation-call", type: "function", function: { name: "run_shell", arguments: '{"command":"node --check packages/cli/dist/index.js"}' } }]
                },
                finish_reason: "tool_calls"
              }]
            }), { status: 200 });
      }
    });
    const terminal = tuiTerminal(["/connect", "0", "test-key", "0", "Run connected task", "/exit"]);
    testIo.tui = terminal;

    try {
      const exitCode = await runCli(["--permission-mode", "bypass", "--isolated-environment"], testIo);

      expect(exitCode).toBe(0);
      expect(terminal.output.some((line) => line.includes("Connected: OpenAI / GPT-5.4"))).toBe(true);
      expect(terminal.output.some((line) => line.includes("connected task complete"))).toBe(true);
      expect(terminal.output.join("\n")).not.toContain("test-key");
    } finally {
      await rm(configHome, { recursive: true, force: true });
    }
  });
});
