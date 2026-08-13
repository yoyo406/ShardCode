import type { PermissionDecision, PermissionRequest } from "@shardcode/shared";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { formatSlashHelp, parseInteractiveInput, type SlashCommand } from "./slash.js";
import { sanitizeTerminalText } from "./render.js";

const MAX_RENDERED_LINES = 200;
const MAX_LINE_LENGTH = 4_000;

export type TuiStatus = "waiting" | "running" | "completed" | "failed" | "aborted";

export type InteractiveTaskRequest =
  | { kind: "run"; prompt: string }
  | { kind: "resume"; sessionId: string };

export interface TuiSessionSnapshot {
  id: string;
  status: string;
  provider: string;
  model: string;
  prompt: string;
  updatedAt: string;
}

export interface TuiExecutionResult {
  exitCode: number;
  session?: TuiSessionSnapshot;
}

export interface InteractiveRuntimeInfo {
  provider: string;
  model: string;
  permissionMode: string;
  isolatedEnvironment: boolean;
}

export interface TuiConnectionOption {
  id: string;
  label: string;
}

export interface TuiConnectionResult {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
}

export interface TuiTerminal {
  readonly isTTY: boolean;
  open(workspaceRoot: string): void;
  question(prompt: string): Promise<string>;
  confirm(question: string): Promise<boolean>;
  select(title: string, options: readonly TuiConnectionOption[]): Promise<number | undefined>;
  secret(prompt: string): Promise<string | undefined>;
  write(line: string): void;
  error(line: string): void;
  clear(): void;
  setStatus(status: TuiStatus): void;
  finish(exitCode: number): void;
  close(): void;
}

export interface TuiExecutionIO {
  write(line: string): void;
  error(line: string): void;
  ask(question: string, request?: PermissionRequest, decision?: PermissionDecision): Promise<boolean>;
}

export interface TuiConnectionIO {
  select(title: string, options: readonly TuiConnectionOption[]): Promise<number | undefined>;
  secret(prompt: string): Promise<string | undefined>;
  write(line: string): void;
  error(line: string): void;
}

export interface InteractiveTuiOptions {
  terminal: TuiTerminal;
  workspaceRoot: string;
  info: InteractiveRuntimeInfo;
  execute(request: InteractiveTaskRequest, io: TuiExecutionIO): Promise<TuiExecutionResult>;
  connect?(io: TuiConnectionIO): Promise<TuiConnectionResult | undefined>;
}

function statusFromExitCode(exitCode: number): TuiStatus {
  if (exitCode === 0) return "completed";
  if (exitCode === 130) return "aborted";
  return "failed";
}

function safe(value: string): string {
  return sanitizeTerminalText(value);
}

function renderStatus(snapshot: TuiSessionSnapshot | undefined): string {
  if (!snapshot) return "No task has run in this TUI session.";
  return [
    `Last session: ${safe(snapshot.id)}`,
    `Status: ${safe(snapshot.status)}`,
    `Task: ${safe(snapshot.prompt)}`,
    `Provider: ${safe(snapshot.provider)}`,
    `Model: ${safe(snapshot.model)}`,
    `Updated: ${safe(snapshot.updatedAt)}`
  ].join("\n");
}

function isInterrupt(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return error.name === "AbortError" || code === "ABORT_ERR";
}

async function executeRequest(
  options: InteractiveTuiOptions,
  request: InteractiveTaskRequest,
  io: TuiExecutionIO
): Promise<TuiExecutionResult> {
  try {
    return await options.execute(request, io);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.terminal.error(message);
    return { exitCode: 1 };
  }
}

function renderLocalCommand(
  command: SlashCommand,
  options: InteractiveTuiOptions,
  lastSession: TuiSessionSnapshot | undefined,
  info: InteractiveRuntimeInfo
): { exit: boolean; lastSession: TuiSessionSnapshot | undefined } {
  switch (command.name) {
    case "help":
      options.terminal.write(formatSlashHelp(command.target));
      return { exit: false, lastSession };
    case "clear":
      options.terminal.clear();
      return { exit: false, lastSession };
    case "status":
      options.terminal.write(renderStatus(lastSession));
      return { exit: false, lastSession };
    case "model":
      options.terminal.write(`Provider: ${safe(info.provider)}\nModel: ${safe(info.model)}`);
      return { exit: false, lastSession };
    case "permissions":
      options.terminal.write(
        `Permission mode: ${safe(info.permissionMode)}\nIsolated environment: ${info.isolatedEnvironment ? "yes" : "no"}`
      );
      return { exit: false, lastSession };
    case "resume":
    case "connect":
      return { exit: false, lastSession };
    case "exit":
      return { exit: true, lastSession };
  }
}

export async function runInteractiveTui(options: InteractiveTuiOptions): Promise<number> {
  let exitCode = 0;
  let opened = false;
  let lastSession: TuiSessionSnapshot | undefined;
  const activeInfo: InteractiveRuntimeInfo = { ...options.info };
  const io: TuiExecutionIO = {
    write: (line) => options.terminal.write(line),
    error: (line) => options.terminal.error(line),
    ask: (question) => options.terminal.confirm(safe(question))
  };

  try {
    if (!options.terminal.isTTY) {
      options.terminal.error("Interactive mode requires a TTY.");
      exitCode = 1;
      return exitCode;
    }

    options.terminal.open(options.workspaceRoot);
    opened = true;

    while (true) {
      options.terminal.setStatus("waiting");
      const input = await options.terminal.question("Task or /command: ");
      const parsed = parseInteractiveInput(input);

      if (parsed.kind === "invalid") {
        options.terminal.error(parsed.message);
        continue;
      }

      if (parsed.kind === "command") {
        if (parsed.command.name === "exit") return exitCode;
        if (parsed.command.name === "resume") {
          options.terminal.setStatus("running");
          const result = await executeRequest(options, { kind: "resume", sessionId: parsed.command.sessionId }, io);
          exitCode = result.exitCode;
          if (result.session) lastSession = result.session;
          options.terminal.setStatus(statusFromExitCode(result.exitCode));
          continue;
        }
        if (parsed.command.name === "connect") {
          if (!options.connect) {
            options.terminal.error("Provider connection is unavailable.");
            continue;
          }
          try {
            const connection = await options.connect({
              select: (title, choices) => options.terminal.select(title, choices),
              secret: (prompt) => options.terminal.secret(prompt),
              write: (line) => options.terminal.write(line),
              error: (line) => options.terminal.error(line)
            });
            if (connection) {
              activeInfo.provider = connection.providerLabel;
              activeInfo.model = connection.modelLabel;
              options.terminal.write(`Connected: ${safe(connection.providerLabel)} / ${safe(connection.modelLabel)}`);
            } else {
              options.terminal.write("Provider connection cancelled.");
            }
          } catch (error) {
            options.terminal.error(error instanceof Error ? error.message : String(error));
          }
          continue;
        }
        renderLocalCommand(parsed.command, options, lastSession, activeInfo);
        continue;
      }

      options.terminal.setStatus("running");
      const result = await executeRequest(options, { kind: "run", prompt: parsed.prompt }, io);
      exitCode = result.exitCode;
      if (result.session) lastSession = result.session;
      options.terminal.setStatus(statusFromExitCode(result.exitCode));
    }
  } catch (error) {
    if (isInterrupt(error)) {
      exitCode = 130;
    } else {
      options.terminal.error(error instanceof Error ? error.message : String(error));
      exitCode = 1;
    }
    return exitCode;
  } finally {
    if (opened) options.terminal.finish(exitCode);
    options.terminal.close();
  }
}

export function createDefaultTuiTerminal(): TuiTerminal {
  const isTTY = Boolean(stdin.isTTY && stdout.isTTY);
  const lines: string[] = [];
  const queuedInput: string[] = [];
  const waitingQuestions: Array<{
    resolve(value: string): void;
    reject(error: Error): void;
  }> = [];
  let inputReader: ReturnType<typeof createInterface> | undefined;
  let inputClosed = false;
  let workspaceRoot = "";
  let status: TuiStatus = "waiting";
  let activeSecretCleanup: (() => void) | undefined;

  function inputClosedError(message = "Interactive input closed"): Error {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
  }

  function rejectWaitingQuestions(error: Error): void {
    while (waitingQuestions.length > 0) waitingQuestions.shift()?.reject(error);
  }

  function receiveLine(line: string): void {
    const waiting = waitingQuestions.shift();
    if (waiting) {
      waiting.resolve(line);
    } else {
      queuedInput.push(line);
    }
  }

  function openInputReader(): void {
    inputClosed = false;
    queuedInput.length = 0;
    inputReader = createInterface({ input: stdin, output: stdout });
    inputReader.on("line", receiveLine);
    inputReader.on("SIGINT", () => {
      inputClosed = true;
      rejectWaitingQuestions(inputClosedError("Interactive input interrupted"));
      inputReader?.close();
    });
    inputReader.on("close", () => {
      inputClosed = true;
      rejectWaitingQuestions(inputClosedError());
    });
  }

  function askInput(prompt: string): Promise<string> {
    if (!inputReader) return Promise.reject(inputClosedError());
    stdout.write(sanitizeTerminalText(prompt));
    const queued = queuedInput.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (inputClosed) return Promise.reject(inputClosedError());
    return new Promise<string>((resolve, reject) => {
      waitingQuestions.push({ resolve, reject });
    });
  }

  function askSecret(prompt: string): Promise<string | undefined> {
    const queued = queuedInput.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    const reader = inputReader;
    if (!reader || inputClosed) return Promise.resolve(undefined);
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return askInput(prompt);

    return new Promise<string | undefined>((resolve, reject) => {
      const characters: string[] = [];
      const cleanup = (): void => {
        stdin.off("data", onData);
        stdin.setRawMode?.(false);
        reader.resume();
        activeSecretCleanup = undefined;
      };
      const finish = (value: string | undefined): void => {
        cleanup();
        stdout.write("\n");
        resolve(value);
      };
      const onData = (chunk: Buffer | string): void => {
        for (const character of String(chunk)) {
          if (character === "\u0003") {
            cleanup();
            reject(inputClosedError("Interactive input interrupted"));
            return;
          }
          if (character === "\r" || character === "\n") {
            finish(characters.join(""));
          } else if (character === "\u007f" || character === "\b") {
            if (characters.length > 0) {
              characters.pop();
              stdout.write("\b \b");
            }
          } else if (character >= " ") {
            characters.push(character);
            stdout.write("*");
          }
        }
      };
      activeSecretCleanup = () => {
        cleanup();
        resolve(undefined);
      };
      stdout.write(sanitizeTerminalText(prompt));
      reader.pause();
      stdin.setRawMode(true);
      stdin.on("data", onData);
    });
  }

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

  return {
    isTTY,
    open: (root) => {
      workspaceRoot = root;
      lines.length = 0;
      status = "waiting";
      openInputReader();
      redraw();
    },
    question: (prompt) => askInput(prompt),
    confirm: async (question) => {
      const answer = await askInput(`${sanitizeTerminalText(question)} [y/N] `);
      return ["y", "yes", "o", "oui"].includes(answer.trim().toLowerCase());
    },
    select: async (title, options) => {
      if (options.length === 0) return undefined;
      const menu = [title, ...options.map((option, index) => `${index + 1}. ${sanitizeTerminalText(option.label)}`), ""].join("\n");
      const answer = await askInput(`${menu}Choose a number: `);
      const index = Number(answer.trim()) - 1;
      return Number.isInteger(index) && index >= 0 && index < options.length ? index : undefined;
    },
    secret: (prompt) => askSecret(prompt),
    write: (line) => appendLine("", line),
    error: (line) => appendLine("[error] ", line),
    clear: () => {
      lines.length = 0;
      redraw();
    },
    setStatus: (nextStatus) => {
      status = nextStatus;
      redraw();
    },
    finish: (exitCode) => {
      status = statusFromExitCode(exitCode);
      redraw();
    },
    close: () => {
      inputClosed = true;
      activeSecretCleanup?.();
      rejectWaitingQuestions(inputClosedError());
      inputReader?.close();
      inputReader = undefined;
      queuedInput.length = 0;
    }
  };
}
