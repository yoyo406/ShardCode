import { describe, expect, it } from "vitest";
import {
  runInteractiveTui,
  type InteractiveTaskRequest,
  type TuiExecutionResult,
  type TuiSessionSnapshot,
  type TuiTerminal,
  type TuiConnectionOption,
  type TuiConnectionResult
} from "./tui.js";

function fakeTerminal(answers: string[], isTTY = true): TuiTerminal & {
  opened: string[];
  questions: string[];
  confirmations: string[];
  lines: string[];
  errors: string[];
  finished: number[];
    statuses: string[];
  selections: string[];
  secrets: string[];
  clearCount: number;
  closed: number;
} {
  const state = {
    opened: [] as string[],
    questions: [] as string[],
    confirmations: [] as string[],
    lines: [] as string[],
    errors: [] as string[],
    finished: [] as number[],
    statuses: [] as string[],
    selections: [] as string[],
    secrets: [] as string[],
    clearCount: 0,
    closed: 0
  };
  return {
    isTTY,
    opened: state.opened,
    questions: state.questions,
    confirmations: state.confirmations,
    selections: state.selections,
    secrets: state.secrets,
    lines: state.lines,
    errors: state.errors,
    finished: state.finished,
    statuses: state.statuses,
    get clearCount() { return state.clearCount; },
    get closed() { return state.closed; },
    open: (workspaceRoot: string): void => { state.opened.push(workspaceRoot); },
    question: async (prompt: string) => {
      state.questions.push(prompt);
      return answers.shift() ?? "/exit";
    },
    confirm: async (question: string) => {
      state.confirmations.push(question);
      return true;
    },
    select: async (title: string, options: readonly TuiConnectionOption[]) => {
      state.selections.push(`${title}: ${options.map((option) => option.label).join(", ")}`);
      const answer = answers.shift();
      if (answer === undefined) return undefined;
      const index = Number(answer);
      return Number.isInteger(index) && index >= 0 && index < options.length ? index : undefined;
    },
    secret: async (prompt: string) => {
      state.secrets.push(prompt);
      return answers.shift();
    },
    write: (line: string): void => { state.lines.push(line); },
    error: (line: string): void => { state.errors.push(line); },
    clear: (): void => { state.clearCount += 1; },
    setStatus: (status): void => { state.statuses.push(status); },
    finish: (exitCode: number): void => { state.finished.push(exitCode); },
    close: (): void => { state.closed += 1; }
  };
}

const info = {
  provider: "scripted",
  model: "scripted-local",
  permissionMode: "ask",
  isolatedEnvironment: false
};

function snapshot(overrides: Partial<TuiSessionSnapshot> = {}): TuiSessionSnapshot {
  return {
    id: "abc-123",
    status: "completed",
    provider: "scripted",
    model: "scripted-local",
    prompt: "Implement OAuth",
    updatedAt: "2026-08-13T00:00:00.000Z",
    ...overrides
  };
}

describe("interactive TUI", () => {
  it("keeps running local commands and tasks in one session", async () => {
    const terminal = fakeTerminal(["/model", "/permissions", "/status", "/clear", "/help status", "/unknown", "Implement OAuth", "/status", "/exit"]);
    const requests: InteractiveTaskRequest[] = [];
    const result = await runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async (request): Promise<TuiExecutionResult> => {
        requests.push(request);
        return { exitCode: 0, session: snapshot() };
      }
    });

    expect(result).toBe(0);
    expect(requests).toEqual([{ kind: "run", prompt: "Implement OAuth" }]);
    expect(terminal.clearCount).toBe(1);
    expect(terminal.statuses).toContain("running");
    expect(terminal.lines.join("\n")).toContain("scripted-local");
    expect(terminal.lines.join("\n")).toContain("Last session: abc-123");
    expect(terminal.errors.join("\n")).toContain("Unknown slash command");
    expect(terminal.finished).toEqual([0]);
    expect(terminal.closed).toBe(1);
  });

  it("dispatches resume locally and does not send slash commands to execution", async () => {
    const terminal = fakeTerminal(["/resume abc-123", "/exit"]);
    const requests: InteractiveTaskRequest[] = [];
    const result = await runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async (request): Promise<TuiExecutionResult> => {
        requests.push(request);
        return { exitCode: 0, session: snapshot({ prompt: "Resumed task" }) };
      }
    });

    expect(result).toBe(0);
    expect(requests).toEqual([{ kind: "resume", sessionId: "abc-123" }]);
  });

  it("opens /connect, keeps the key out of rendering, and updates /model", async () => {
    const terminal = fakeTerminal(["/connect", "0", "secret-key", "0", "/model", "/exit"]);
    let connected: TuiConnectionResult | undefined;
    const result = await runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      connect: async (io) => {
        const providerIndex = await io.select("Provider", [{ id: "openai", label: "OpenAI" }]);
        const apiKey = await io.secret("API key: ");
        const modelIndex = await io.select("Model", [{ id: "gpt-5.4", label: "GPT-5.4" }]);
        if (providerIndex === undefined || modelIndex === undefined || !apiKey) return undefined;
        connected = { providerId: "openai", providerLabel: "OpenAI", modelId: "gpt-5.4", modelLabel: "GPT-5.4" };
        return connected;
      },
      execute: async () => ({ exitCode: 0 })
    });

    expect(result).toBe(0);
    expect(connected).toMatchObject({ providerId: "openai", modelId: "gpt-5.4" });
    expect(terminal.secrets).toEqual(["API key: "]);
    expect(terminal.lines.join("\n")).toContain("Provider: OpenAI\nModel: GPT-5.4");
    expect(terminal.lines.join("\n")).not.toContain("secret-key");
  });

  it("re-prompts empty tasks and forwards execution output and permissions", async () => {
    const terminal = fakeTerminal(["   ", "Implement OAuth", "/exit"]);
    const exitCode = await runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async (request, io) => {
        expect(request).toEqual({ kind: "run", prompt: "Implement OAuth" });
        io.write("[tool] completed");
        expect(await io.ask("run tests?")).toBe(true);
        return { exitCode: 7 };
      }
    });

    expect(exitCode).toBe(7);
    expect(terminal.opened).toEqual(["/repo"]);
    expect(terminal.questions).toHaveLength(3);
    expect(terminal.errors).toContain("A task description is required.");
    expect(terminal.lines).toContain("[tool] completed");
    expect(terminal.confirmations).toEqual(["run tests?"]);
    expect(terminal.finished).toEqual([7]);
    expect(terminal.closed).toBe(1);
  });

  it("continues after a task callback error", async () => {
    const terminal = fakeTerminal(["Implement OAuth", "/status", "/exit"]);
    let calls = 0;
    const result = await runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async () => {
        calls += 1;
        throw new Error("runtime unavailable");
      }
    });

    expect(result).toBe(1);
    expect(calls).toBe(1);
    expect(terminal.errors).toContain("runtime unavailable");
    expect(terminal.lines.join("\n")).toContain("No task has run in this TUI session.");
  });

  it("fails closed when no interactive terminal is available", async () => {
    const terminal = fakeTerminal([], false);
    let executed = false;
    const exitCode = await runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async () => {
        executed = true;
        return { exitCode: 0 };
      }
    });

    expect(exitCode).toBe(1);
    expect(executed).toBe(false);
    expect(terminal.errors.join("\n")).toContain("TTY");
    expect(terminal.closed).toBe(1);
  });
});
