import { describe, expect, it } from "vitest";
import { runInteractiveTui, type TuiTerminal } from "./tui.js";

function fakeTerminal(answers: string[], isTTY = true): TuiTerminal & {
  opened: string[];
  questions: string[];
  confirmations: string[];
  lines: string[];
  errors: string[];
  finished: number[];
  closed: number;
} {
  const state = {
    opened: [] as string[],
    questions: [] as string[],
    confirmations: [] as string[],
    lines: [] as string[],
    errors: [] as string[],
    finished: [] as number[],
    closed: 0
  };
  return {
    isTTY,
    opened: state.opened,
    questions: state.questions,
    confirmations: state.confirmations,
    lines: state.lines,
    errors: state.errors,
    finished: state.finished,
    get closed() { return state.closed; },
    open: (workspaceRoot: string): void => { state.opened.push(workspaceRoot); },
    question: async (prompt: string) => {
      state.questions.push(prompt);
      return answers.shift() ?? "";
    },
    confirm: async (question: string) => {
      state.confirmations.push(question);
      return true;
    },
    write: (line: string): void => { state.lines.push(line); },
    error: (line: string): void => { state.errors.push(line); },
    finish: (exitCode: number): void => { state.finished.push(exitCode); },
    close: (): void => { state.closed += 1; }
  };
}

describe("interactive TUI", () => {
  it("re-prompts empty tasks and forwards execution output and permissions", async () => {
    const terminal = fakeTerminal(["   ", "Implement OAuth"]);
    const exitCode = await runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      execute: async (prompt, io) => {
        expect(prompt).toBe("Implement OAuth");
        io.write("[tool] completed");
        expect(await io.ask("run tests?")).toBe(true);
        return 7;
      }
    });

    expect(exitCode).toBe(7);
    expect(terminal.opened).toEqual(["/repo"]);
    expect(terminal.questions).toHaveLength(2);
    expect(terminal.lines).toContain("A task description is required.");
    expect(terminal.lines).toContain("[tool] completed");
    expect(terminal.confirmations).toEqual(["run tests?"]);
    expect(terminal.finished).toEqual([7]);
    expect(terminal.closed).toBe(1);
  });

  it("fails closed when no interactive terminal is available", async () => {
    const terminal = fakeTerminal([], false);
    let executed = false;
    const exitCode = await runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      execute: async () => {
        executed = true;
        return 0;
      }
    });

    expect(exitCode).toBe(1);
    expect(executed).toBe(false);
    expect(terminal.errors.join("\n")).toContain("TTY");
    expect(terminal.closed).toBe(1);
  });
});
