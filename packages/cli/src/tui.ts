import type { PermissionDecision, PermissionRequest } from "@shardcode/shared";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { sanitizeTerminalText } from "./render.js";

const MAX_RENDERED_LINES = 200;
const MAX_LINE_LENGTH = 4_000;

export interface TuiTerminal {
  readonly isTTY: boolean;
  open(workspaceRoot: string): void;
  question(prompt: string): Promise<string>;
  confirm(question: string): Promise<boolean>;
  write(line: string): void;
  error(line: string): void;
  finish(exitCode: number): void;
  close(): void;
}

export interface TuiExecutionIO {
  write(line: string): void;
  error(line: string): void;
  ask(question: string, request?: PermissionRequest, decision?: PermissionDecision): Promise<boolean>;
}

export interface InteractiveTuiOptions {
  terminal: TuiTerminal;
  workspaceRoot: string;
  execute(prompt: string, io: TuiExecutionIO): Promise<number>;
}

export async function runInteractiveTui(options: InteractiveTuiOptions): Promise<number> {
  let exitCode = 1;
  let opened = false;
  try {
    if (!options.terminal.isTTY) {
      options.terminal.error("Interactive mode requires a TTY.");
      return exitCode;
    }

    options.terminal.open(options.workspaceRoot);
    opened = true;
    let prompt = "";
    while (!prompt.trim()) {
      prompt = await options.terminal.question("Task: ");
      if (!prompt.trim()) options.terminal.write("A task description is required.");
    }

    exitCode = await options.execute(prompt.trim(), {
      write: (line) => options.terminal.write(line),
      error: (line) => options.terminal.error(line),
      ask: (question) => options.terminal.confirm(sanitizeTerminalText(question))
    });
    return exitCode;
  } catch (error) {
    options.terminal.error(error instanceof Error ? error.message : String(error));
    return exitCode;
  } finally {
    if (opened) options.terminal.finish(exitCode);
    options.terminal.close();
  }
}

export function createDefaultTuiTerminal(): TuiTerminal {
  const isTTY = Boolean(stdin.isTTY && stdout.isTTY);
  const lines: string[] = [];
  let workspaceRoot = "";
  let finalStatus: string | undefined;

  function appendLine(prefix: string, value: string): void {
    const sanitized = sanitizeTerminalText(value);
    for (const line of sanitized.split("\n")) {
      const bounded = line.length > MAX_LINE_LENGTH
        ? `${line.slice(0, MAX_LINE_LENGTH - 1)}…`
        : line;
      lines.push(`${prefix}${bounded}`);
    }
    if (lines.length > MAX_RENDERED_LINES) lines.splice(0, lines.length - MAX_RENDERED_LINES);
    redraw();
  }

  function redraw(): void {
    const status = finalStatus ?? "waiting for task";
    const content = [
      "\u001b[2J\u001b[H",
      "ShardCode — interactive",
      `Workspace: ${sanitizeTerminalText(workspaceRoot)}`,
      `Status: ${status}`,
      "",
      ...lines,
      "",
      "Ctrl+C to stop"
    ].join("\n");
    stdout.write(`${content}\n`);
  }

  async function withPrompt<T>(callback: (terminal: ReturnType<typeof createInterface>) => Promise<T>): Promise<T> {
    const terminal = createInterface({ input: stdin, output: stdout });
    try {
      return await callback(terminal);
    } finally {
      terminal.close();
    }
  }

  return {
    isTTY,
    open: (root) => {
      workspaceRoot = root;
      lines.length = 0;
      finalStatus = undefined;
      redraw();
    },
    question: (prompt) => withPrompt((terminal) => terminal.question(sanitizeTerminalText(prompt))),
    confirm: async (question) => {
      const answer = await withPrompt((terminal) => terminal.question(`${sanitizeTerminalText(question)} [y/N] `));
      return ["y", "yes", "o", "oui"].includes(answer.trim().toLowerCase());
    },
    write: (line) => appendLine("", line),
    error: (line) => appendLine("[error] ", line),
    finish: (exitCode) => {
      finalStatus = exitCode === 0 ? "completed" : exitCode === 130 ? "aborted" : "failed";
      redraw();
    },
    close: () => undefined
  };
}
