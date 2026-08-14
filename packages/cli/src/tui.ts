import { createInterface } from "node:readline/promises";
import { parseInteractiveInput, type SlashCommand } from "./slash.js";
import { sanitizeTerminalText, sanitizeTuiTerminalText } from "./render.js";
import { detectTuiCapabilities, styleTuiText, type TuiTone } from "./theme.js";

const MAX_HISTORY_LINES = 200;
const MAX_HISTORY_LINE_LENGTH = 4_000;
const SUGGESTIONS = [
  "Inspect the repository and suggest the next change",
  "Run the tests and explain any failures",
  "Review the current changes for risks"
] as const;

export type TuiStyle = (text: string, tone: TuiTone) => string;

export interface TuiTerminal {
  isTTY: boolean;
  open(): Promise<void> | void;
  question(prompt: string): Promise<string>;
  confirm(prompt: string): Promise<boolean>;
  secret?(prompt: string): Promise<string | undefined>;
  write(line: string): void;
  error(line: string): void;
  clear(): void;
  setStatus(status: string): void;
  finish(exitCode: number): void;
  close(): void;
  style?: TuiStyle;
  sanitize?(line: string): string;
}

interface DefaultTuiTerminal extends TuiTerminal {
  secret(prompt: string): Promise<string | undefined>;
}

type TuiInputStream = NodeJS.ReadableStream & {
  isTTY?: boolean;
  setRawMode?(enabled: boolean): void;
  resume(): void;
};

type TuiOutputStream = NodeJS.WritableStream & { isTTY?: boolean };

export interface DefaultTuiTerminalOptions {
  input?: TuiInputStream;
  output?: TuiOutputStream;
  errorOutput?: NodeJS.WritableStream;
  env?: Record<string, string | undefined>;
}

export interface TuiRuntimeInfo {
  readonly permissionMode: string;
  readonly provider: string;
  readonly model: string;
}

export interface TuiSessionSnapshot {
  sessionId?: string;
  status?: string;
}

export type InteractiveTaskRequest =
  | { kind: "run"; prompt: string }
  | { kind: "resume"; sessionId: string };

export interface InteractiveTaskResult {
  exitCode: number;
  session?: TuiSessionSnapshot;
  output?: readonly string[];
}

export interface InteractiveTuiOptions {
  terminal: TuiTerminal;
  workspaceRoot: string;
  info: TuiRuntimeInfo;
  execute(request: InteractiveTaskRequest): Promise<InteractiveTaskResult>;
  connect?(): Promise<void> | void;
}

function paint(text: string, tone: TuiTone, style?: TuiStyle): string {
  const safeText = sanitizeTerminalText(text);
  return style ? style(safeText, tone) : safeText;
}

function line(label: string, value: string, tone: TuiTone, style?: TuiStyle): string {
  return `${paint(label, "normal", style)} ${paint(value, tone, style)}`;
}

export function renderTuiWelcome(
  workspaceRoot: string,
  info: TuiRuntimeInfo,
  suggestion: string,
  style?: TuiStyle
): string[] {
  return [
    paint("ShardCode", "primary", style),
    paint("A focused coding session for your repository.", "normal", style),
    line("Workspace:", workspaceRoot, "info", style),
    line("Provider:", `${info.provider} / ${info.model}`, "accent", style),
    line("Try:", suggestion, "accent", style),
    paint("Type a task, or /help for commands.", "normal", style)
  ];
}

export function renderTuiFooter(
  workspaceRoot: string,
  info: TuiRuntimeInfo,
  session: TuiSessionSnapshot | undefined,
  status: string,
  style?: TuiStyle
): string[] {
  const statusTone: TuiTone = status === "running"
    ? "info"
    : status === "completed"
      ? "success"
      : status === "failed" || status === "error"
        ? "error"
        : "normal";
  return [
    line("Status:", status, statusTone, style),
    line("Permissions:", info.permissionMode, "warning", style),
    line("Model:", `${info.provider} / ${info.model}`, "accent", style),
    line("Workspace:", workspaceRoot, "info", style),
    line("Last session:", session?.sessionId ?? "none", "normal", style)
  ];
}

function appendHistory(history: string[], value: string): void {
  for (const valueLine of value.split("\n")) {
    history.push(valueLine.slice(0, MAX_HISTORY_LINE_LENGTH));
  }
  if (history.length > MAX_HISTORY_LINES) history.splice(0, history.length - MAX_HISTORY_LINES);
}

function writeHistoryLine(terminal: TuiTerminal, history: string[], value: string): void {
  const safeValue = terminal.sanitize ? terminal.sanitize(value) : sanitizeTerminalText(value);
  appendHistory(history, safeValue);
  const lastLines = history.slice(-safeValue.split("\n").length);
  for (const historyLine of lastLines) terminal.write(historyLine);
}

function writeSessionHeader(terminal: TuiTerminal, session: TuiSessionSnapshot | undefined): void {
  if (session?.sessionId) terminal.write(paint(`Session ${session.sessionId}`, "primary", terminal.style));
}

function writeHelp(terminal: TuiTerminal): void {
  terminal.write(paint("/help /clear /status /model /permissions /resume <id> /connect /exit", "normal", terminal.style));
}

function writeCommandStatus(
  terminal: TuiTerminal,
  workspaceRoot: string,
  info: TuiRuntimeInfo,
  session: TuiSessionSnapshot | undefined,
  status: string
): void {
  for (const footerLine of renderTuiFooter(workspaceRoot, info, session, status, terminal.style)) terminal.write(footerLine);
}

async function runRequest(
  terminal: TuiTerminal,
  request: InteractiveTaskRequest,
  execute: InteractiveTuiOptions["execute"],
  history: string[]
): Promise<InteractiveTaskResult> {
  terminal.setStatus("running");
  try {
    const result = await execute(request);
    for (const output of result.output ?? []) writeHistoryLine(terminal, history, output);
    terminal.setStatus(result.exitCode === 0 ? "completed" : "failed");
    return result;
  } catch (error) {
    terminal.error(sanitizeTerminalText(error instanceof Error ? error.message : String(error)));
    terminal.setStatus("error");
    return { exitCode: 1 };
  } finally {
    terminal.setStatus("waiting");
  }
}

async function handleCommand(
  command: SlashCommand,
  options: InteractiveTuiOptions,
  state: { info: TuiRuntimeInfo; session: TuiSessionSnapshot | undefined; status: string; exitCode: number; suggestionIndex: number },
  history: string[]
): Promise<boolean> {
  const { terminal, workspaceRoot } = options;
  switch (command.name) {
    case "exit":
      return true;
    case "help":
      writeHelp(terminal);
      return false;
    case "clear":
      history.length = 0;
      terminal.clear();
      for (const welcomeLine of renderTuiWelcome(workspaceRoot, state.info, SUGGESTIONS[state.suggestionIndex]!, terminal.style)) terminal.write(welcomeLine);
      writeCommandStatus(terminal, workspaceRoot, state.info, state.session, state.status);
      return false;
    case "status":
      writeCommandStatus(terminal, workspaceRoot, state.info, state.session, state.status);
      return false;
    case "model":
      if (command.model) {
        terminal.write(paint(`Model remains ${state.info.provider} / ${state.info.model} for this session.`, "warning", terminal.style));
      } else {
        terminal.write(line("Model:", `${state.info.provider} / ${state.info.model}`, "accent", terminal.style));
      }
      return false;
    case "permissions":
      if (command.mode) {
        terminal.write(paint(`Permissions remain ${state.info.permissionMode} for this session.`, "warning", terminal.style));
      } else {
        terminal.write(line("Permissions:", state.info.permissionMode, "warning", terminal.style));
      }
      return false;
    case "connect":
      if (!options.connect) {
        terminal.write(paint("Connection is not available in this build.", "warning", terminal.style));
        return false;
      }
      await options.connect();
      terminal.write(paint("Connection updated.", "success", terminal.style));
      return false;
    case "resume": {
      const result = await runRequest(terminal, { kind: "resume", sessionId: command.sessionId }, options.execute, history);
      state.exitCode = result.exitCode;
      state.session = result.session ?? state.session;
      state.status = result.exitCode === 0 ? "waiting" : "failed";
      writeSessionHeader(terminal, state.session);
      return false;
    }
  }
}

export async function runInteractiveTui(options: InteractiveTuiOptions): Promise<number> {
  const { terminal, workspaceRoot } = options;
  if (!terminal.isTTY) {
    terminal.error("Interactive mode requires a TTY.");
    terminal.finish(1);
    terminal.close();
    return 1;
  }

  const history: string[] = [];
  const state = {
    info: { ...options.info },
    session: undefined as TuiSessionSnapshot | undefined,
    status: "waiting",
    exitCode: 0,
    suggestionIndex: 0
  };

  try {
    await terminal.open();
    terminal.setStatus(state.status);
    for (const welcomeLine of renderTuiWelcome(workspaceRoot, state.info, SUGGESTIONS[state.suggestionIndex]!, terminal.style)) terminal.write(welcomeLine);
    writeCommandStatus(terminal, workspaceRoot, state.info, state.session, state.status);

    for (;;) {
      const input = await terminal.question(paint("› ", "primary", terminal.style));
      const parsed = parseInteractiveInput(input);
      if (parsed.kind === "invalid") {
        terminal.error(paint(parsed.message, "error", terminal.style));
        continue;
      }
      if (parsed.kind === "command") {
        if (await handleCommand(parsed.command, options, state, history)) break;
        continue;
      }

      const result = await runRequest(terminal, { kind: "run", prompt: parsed.prompt }, options.execute, history);
      state.exitCode = result.exitCode;
      state.session = result.session ?? state.session;
      state.status = result.exitCode === 0 ? "waiting" : "failed";
      state.suggestionIndex = (state.suggestionIndex + 1) % SUGGESTIONS.length;
      writeSessionHeader(terminal, state.session);
      writeCommandStatus(terminal, workspaceRoot, state.info, state.session, state.status);
    }
  } catch (error) {
    terminal.error(sanitizeTerminalText(error instanceof Error ? error.message : String(error)));
    state.exitCode = 1;
  } finally {
    terminal.finish(state.exitCode);
    terminal.close();
  }
  return state.exitCode;
}

export function secretInputRemainder(value: string): string[] | undefined {
  if (!/[\r\n]/.test(value)) return undefined;
  const lines = value.split(/\r\n|\n|\r/).slice(1);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function createDefaultTuiTerminal(options: DefaultTuiTerminalOptions = {}): DefaultTuiTerminal {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const readline = createInterface({ input, output, terminal: false });
  const capabilities = detectTuiCapabilities(Boolean(input.isTTY), options.env ?? process.env);
  const pendingLines: string[] = [];
  const style: TuiStyle = (text, tone) => styleTuiText(text, tone, capabilities);
  const trustedStyles = new Set<string>(["\u001b[39m"]);
  for (const tone of ["normal", "primary", "accent", "success", "warning", "error", "info"] as const) {
    const probe = styleTuiText("x", tone, capabilities);
    const suffix = "x\u001b[39m";
    if (probe.endsWith(suffix)) trustedStyles.add(probe.slice(0, -suffix.length));
  }
  let cancelActiveSecret: (() => void) | undefined;
  const normalQuestion = async (prompt: string): Promise<string> => {
    const pending = pendingLines.shift();
    if (pending !== undefined) return pending;
    output.write(prompt);
    return readline.question("");
  };
  return {
    isTTY: Boolean(input.isTTY && output.isTTY),
    style,
    sanitize: (value) => sanitizeTuiTerminalText(value, trustedStyles),
    open: async () => undefined,
    question: normalQuestion,
    confirm: async (prompt) => /^(y|yes|o|oui)$/i.test(
      (await normalQuestion(`${style(sanitizeTerminalText(prompt), "warning")} [y/N] `)).trim()
    ),
    secret: async (prompt) => {
      if (!input.isTTY || typeof input.setRawMode !== "function") return normalQuestion(prompt);

      output.write(prompt);
      return new Promise<string | undefined>((resolve) => {
        let secret = "";
        let complete = false;
        const restore = (value: string | undefined, remainder?: string[]): void => {
          if (complete) return;
          complete = true;
          input.removeListener("data", onData);
          input.setRawMode!(false);
          cancelActiveSecret = undefined;
          if (remainder) pendingLines.push(...remainder);
          resolve(value);
        };
        const onData = (chunk: Buffer | string): void => {
          const text = String(chunk);
          for (let index = 0; index < text.length; index += 1) {
            const character = text[index]!;
            if (character === "\u0003") {
              output.write("\n");
              restore(undefined);
              return;
            }
            if (character === "\u0008" || character === "\u007f") {
              if (secret) {
                secret = secret.slice(0, -1);
                output.write("\b \b");
              }
              continue;
            }
            if (character === "\r" || character === "\n") {
              output.write("\n");
              restore(secret, secretInputRemainder(`${secret}${text.slice(index)}`));
              return;
            }
            secret += character;
            output.write("*");
          }
        };
        cancelActiveSecret?.();
        cancelActiveSecret = () => restore(undefined);
        input.setRawMode!(true);
        input.resume();
        input.on("data", onData);
      });
    },
    write: (value) => output.write(`${sanitizeTuiTerminalText(value, trustedStyles)}\n`),
    error: (value) => errorOutput.write(`${sanitizeTuiTerminalText(value, trustedStyles)}\n`),
    clear: () => output.write("\u001b[2J\u001b[H"),
    setStatus: () => undefined,
    finish: () => undefined,
    close: () => {
      cancelActiveSecret?.();
      readline.close();
    }
  };
}
