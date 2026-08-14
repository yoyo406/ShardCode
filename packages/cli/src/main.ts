import type { PermissionDecision, PermissionRequest, ProviderConfig, ShardCodeEvent } from "@shardcode/shared";
import { ContextEngine } from "@shardcode/context-engine";
import { MemoryStore } from "@shardcode/memory";
import { createProvider, createScriptedProvider } from "@shardcode/providers";
import { AgentRuntime, JsonSessionStore } from "@shardcode/runtime";
import { ToolRuntime } from "@shardcode/tool-runtime";
import { parseArgs, HELP_TEXT, type CliOptions, type CliProvider } from "./args.js";
import { askForPermission, sanitizePermissionPrompt } from "./prompts.js";
import { renderEvent, sanitizeTerminalText } from "./render.js";
import {
  createDefaultTuiTerminal,
  runInteractiveTui,
  type InteractiveTaskCallbacks,
  type InteractiveTaskRequest,
  type InteractiveTaskResult,
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

interface TuiExecutionIO {
  write(line: string): void;
}

function createTuiExecutionIO(emit: (line: string) => void): TuiExecutionIO {
  return { write: emit };
}

function defaultIO(): CliIO {
  return {
    write: (line) => process.stdout.write(`${line}\n`),
    error: (line) => process.stderr.write(`${line}\n`),
    ask: async (question) => askForPermission(question),
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

export function writeFinalMessage(io: Pick<CliIO, "write">, message: string | undefined, json: boolean): void {
  if (!json && message) io.write(sanitizeTerminalText(message));
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
        finishReason: "tool_call"
      },
      {
        message: { role: "assistant", content: "SHARDCODE_VALIDATED: scripted repository checks completed" },
        toolCalls: [],
        finishReason: "stop"
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
  if (options.command === "interactive" && options.json) {
    io.error("--json is not available in interactive mode");
    return 2;
  }

  try {
    const tui = options.command === "interactive"
      ? io.tui ?? createDefaultTuiTerminal({ env: io.env })
      : undefined;
    const toolRuntime = await ToolRuntime.create({
      workspaceRoot: io.cwd,
      mode: options.permissionMode,
      isolatedEnvironment: options.isolatedEnvironment,
      ask: async (request, decision) => {
        const question = sanitizePermissionPrompt(`${request.toolName}${request.command ? `: ${request.command}` : request.path ? `: ${request.path}` : ""} — ${decision.reason}`);
        if (tui) return tui.confirm(question);
        return io.ask ? io.ask(question, request, decision) : false;
      }
    });
    const sessionStore = new JsonSessionStore(toolRuntime.storage());

    const executeTask = async (request: InteractiveTaskRequest, callbacks?: InteractiveTaskCallbacks): Promise<InteractiveTaskResult> => {
      let providerOptions = options;
      if (request.kind === "resume" && !options.providerExplicit) {
        const existing = await sessionStore.load(request.sessionId);
        if (existing) {
          providerOptions = {
            ...options,
            provider: existing.provider as CliProvider,
            model: existing.model,
            modelExplicit: true
          };
        }
      }
      const taskIO = tui && callbacks?.onStyledOutput ? createTuiExecutionIO(callbacks.onStyledOutput) : undefined;
      const runtime = new AgentRuntime({
        provider: buildProvider(providerOptions, io.env),
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
        onEvent: async (event: ShardCodeEvent) => renderEvent(
          event,
          taskIO ? taskIO.write : io.write,
          options.json,
          tui?.style ? { style: tui.style } : undefined
        )
      });
      const session = request.kind === "run"
        ? await runtime.run(request.prompt)
        : await runtime.resume(request.sessionId);
      const exitCode = session.status === "completed" ? 0 : session.status === "aborted" ? 130 : 1;
      if (taskIO) {
        writeFinalMessage(taskIO, session.finalMessage, false);
        return {
          exitCode,
          provider: session.provider,
          model: session.model,
          permissionMode: toolRuntime.mode,
          session: { sessionId: session.id, status: session.status },
        };
      }
      writeFinalMessage(io, session.finalMessage, options.json);
      return {
        exitCode,
        provider: session.provider,
        model: session.model,
        permissionMode: toolRuntime.mode,
        session: { sessionId: session.id, status: session.status }
      };
    };

    if (options.command === "interactive") {
      return runInteractiveTui({
        terminal: tui!,
        workspaceRoot: io.cwd,
        info: {
          permissionMode: options.permissionMode,
          provider: options.provider,
          model: options.modelExplicit ? options.model : defaultModel(options.provider)
        },
        execute: executeTask
      });
    }

    return (await executeTask(
      options.command === "run"
        ? { kind: "run", prompt: options.prompt ?? "" }
        : { kind: "resume", sessionId: options.sessionId ?? "" }
    )).exitCode;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
