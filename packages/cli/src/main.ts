import type { PermissionDecision, PermissionRequest, ProviderConfig, Session, ShardCodeEvent } from "@shardcode/shared";
import { ContextEngine } from "@shardcode/context-engine";
import { MemoryStore } from "@shardcode/memory";
import { createProvider, createScriptedProvider } from "@shardcode/providers";
import { AgentRuntime, JsonSessionStore } from "@shardcode/runtime";
import { ToolRuntime } from "@shardcode/tool-runtime";
import { parseArgs, HELP_TEXT, type CliOptions, type CliProvider } from "./args.js";
import { askForPermission } from "./prompts.js";
import { renderEvent, sanitizeTerminalText } from "./render.js";
import {
  createDefaultTuiTerminal,
  runInteractiveTui,
  type InteractiveTaskRequest,
  type TuiExecutionResult,
  type TuiSessionSnapshot,
  type TuiTerminal
} from "./tui.js";

export interface CliIO {
  write(line: string): void;
  error(line: string): void;
  ask?(question: string, request?: PermissionRequest, decision?: PermissionDecision): Promise<boolean>;
  tui?: TuiTerminal;
  cwd: string;
  env: Record<string, string | undefined>;
}

function defaultIO(): CliIO {
  return {
    write: (line) => process.stdout.write(`${sanitizeTerminalText(line)}\n`),
    error: (line) => process.stderr.write(`${sanitizeTerminalText(line)}\n`),
    ask: async (question) => askForPermission(question),
    tui: createDefaultTuiTerminal(),
    cwd: process.cwd(),
    env: process.env
  };
}

function defaultModel(provider: CliProvider): string {
  switch (provider) {
    case "anthropic": return "claude-3-5-sonnet-20241022";
    case "gemini": return "gemini-2.0-flash";
    case "scripted": return "scripted-local";
    case "openai": return "gpt-4o-mini";
  }
}

function environmentKey(provider: CliProvider): string | undefined {
  switch (provider) {
    case "openai": return "OPENAI_API_KEY";
    case "anthropic": return "ANTHROPIC_API_KEY";
    case "gemini": return "GEMINI_API_KEY";
    case "scripted": return undefined;
  }
}

function buildProvider(options: CliOptions, env: Record<string, string | undefined>) {
  const model = options.modelExplicit ? options.model : defaultModel(options.provider);
  if (options.provider === "scripted") {
    return createScriptedProvider(model, [
      {
        message: {
          role: "assistant",
          content: "I will run the repository checks.",
          toolCalls: [{ id: "scripted-check", name: "run_shell", arguments: { command: "node -e \"console.log('scripted check')\"" } }]
        },
        toolCalls: [{ id: "scripted-check", name: "run_shell", arguments: { command: "node -e \"console.log('scripted check')\"" } }],
        finishReason: "tool_call",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
      },
      {
        message: {
          role: "assistant",
          content: "SHARDCODE_VALIDATED: scripted repository checks completed"
        },
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
      }
    ]);
  }
  const keyName = environmentKey(options.provider);
  const apiKey = keyName ? env[keyName] : undefined;
  const config: ProviderConfig = {
    provider: options.provider,
    model,
    ...(apiKey ? { apiKey } : {})
  };
  return createProvider(config);
}

type TaskCliOptions = CliOptions & { command: "run" | "resume" };

interface TaskExecutionResult {
  exitCode: number;
  session?: Session;
}

function asTaskOptions(options: CliOptions): TaskCliOptions {
  if (options.command !== "run" && options.command !== "resume") {
    throw new Error(`Unsupported task command: ${options.command}`);
  }
  return options as TaskCliOptions;
}

function sessionSnapshot(session: Session): TuiSessionSnapshot {
  return {
    id: session.id,
    status: session.status,
    provider: session.provider,
    model: session.model,
    prompt: session.rootTask.prompt,
    updatedAt: session.updatedAt
  };
}

export function renderFinalMessage(content: string): string {
  return sanitizeTerminalText(content);
}

async function executeTask(options: TaskCliOptions, io: CliIO): Promise<TaskExecutionResult> {
  try {
    const toolRuntime = await ToolRuntime.create({
      workspaceRoot: io.cwd,
      mode: options.permissionMode,
      isolatedEnvironment: options.isolatedEnvironment,
      ask: async (request, decision) => io.ask ? io.ask(
        sanitizeTerminalText(`${request.toolName}${request.command ? `: ${request.command}` : request.path ? `: ${request.path}` : ""} — ${decision.reason}`),
        request,
        decision
      ) : false
    });
    const sessionStore = new JsonSessionStore(toolRuntime.storage());
    let providerOptions = options;
    if (options.command === "resume" && options.sessionId && !options.providerExplicit) {
      const existing = await sessionStore.load(options.sessionId);
      if (existing) {
        providerOptions = {
          ...options,
          provider: existing.provider as CliProvider,
          model: existing.model,
          modelExplicit: true
        };
      }
    }
    const provider = buildProvider(providerOptions, io.env);
    const runtime = new AgentRuntime({
      provider,
      tools: toolRuntime,
      context: new ContextEngine(toolRuntime),
      memory: new MemoryStore(toolRuntime.storage()),
      sessionStore,
      workspaceRoot: io.cwd,
      budget: {
        maxTokens: options.maxTokens,
        maxToolCalls: options.maxToolCalls,
        maxWallClockSeconds: options.maxWallClockSeconds
      },
      onEvent: async (event: ShardCodeEvent) => renderEvent(event, io.write, options.json)
    });
    const session = options.command === "run"
      ? await runtime.run(options.prompt ?? "")
      : await runtime.resume(options.sessionId ?? "");
    if (!options.json && session.finalMessage) io.write(renderFinalMessage(session.finalMessage));
    return {
      exitCode: session.status === "completed" ? 0 : session.status === "aborted" ? 130 : 1,
      session
    };
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return { exitCode: 1 };
  }
}

export async function runCli(argv: string[], suppliedIO?: CliIO): Promise<number> {
  const io = suppliedIO ?? defaultIO();
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (options.command === "help") {
    io.write(HELP_TEXT);
    return 0;
  }
  if (options.command === "interactive") {
    if (options.json) {
      io.error("--json cannot be used with interactive mode.");
      return 2;
    }
    const terminal = io.tui ?? createDefaultTuiTerminal();
    return runInteractiveTui({
      terminal,
      workspaceRoot: io.cwd,
      info: {
        provider: options.provider,
        model: options.modelExplicit ? options.model : defaultModel(options.provider),
        permissionMode: options.permissionMode,
        isolatedEnvironment: options.isolatedEnvironment
      },
      execute: async (request: InteractiveTaskRequest, tuiIO): Promise<TuiExecutionResult> => {
        const taskOptions: TaskCliOptions = request.kind === "run"
          ? { ...options, command: "run", prompt: request.prompt }
          : { ...options, command: "resume", sessionId: request.sessionId };
        const result = await executeTask(
          taskOptions,
          { ...io, write: tuiIO.write, error: tuiIO.error, ask: tuiIO.ask }
        );
        return {
          exitCode: result.exitCode,
          ...(result.session ? { session: sessionSnapshot(result.session) } : {})
        };
      }
    });
  }
  if (options.command === "run" || options.command === "resume") {
    return (await executeTask(asTaskOptions(options), io)).exitCode;
  }
  io.error(`Unsupported CLI command: ${options.command}`);
  return 2;
}
