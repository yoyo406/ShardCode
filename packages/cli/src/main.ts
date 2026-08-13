import type { PermissionDecision, PermissionRequest, ProviderConfig, ShardCodeEvent } from "@shardcode/shared";
import { resolve } from "node:path";
import { ContextEngine } from "@shardcode/context-engine";
import { MemoryStore } from "@shardcode/memory";
import { createProvider, createScriptedProvider } from "@shardcode/providers";
import { AgentRuntime, JsonSessionStore } from "@shardcode/runtime";
import { FileStorage, ToolRuntime } from "@shardcode/tool-runtime";
import { parseArgs, HELP_TEXT, type CliOptions, type CliProvider } from "./args.js";
import { askForPermission } from "./prompts.js";
import { renderEvent } from "./render.js";

export interface CliIO {
  write(line: string): void;
  error(line: string): void;
  ask?(question: string, request?: PermissionRequest, decision?: PermissionDecision): Promise<boolean>;
  cwd: string;
  env: Record<string, string | undefined>;
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

function buildProvider(options: CliOptions, env: Record<string, string | undefined>) {
  const model = options.modelExplicit ? options.model : defaultModel(options.provider);
  if (options.provider === "scripted") {
    return createScriptedProvider(model, [
      {
        message: {
          role: "assistant",
          content: "I will run the repository checks.",
          toolCalls: [{ id: "scripted-check", name: "run_shell", arguments: { command: "node --check packages/cli/dist/index.js" } }]
        },
        toolCalls: [{ id: "scripted-check", name: "run_shell", arguments: { command: "node --check packages/cli/dist/index.js" } }],
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

  try {
    const workspaceRoot = resolve(io.env.SHARDCODE_WORKSPACE_ROOT ?? io.env.INIT_CWD ?? io.cwd);
    const toolRuntime = await ToolRuntime.create({
      workspaceRoot,
      mode: options.permissionMode,
      isolatedEnvironment: options.isolatedEnvironment,
      ask: async (request, decision) => io.ask ? io.ask(
        `${request.toolName}${request.command ? `: ${request.command}` : request.path ? `: ${request.path}` : ""} — ${decision.reason}`,
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
      memory: new MemoryStore(toolRuntime.storage(), new FileStorage(workspaceRoot)),
      sessionStore,
      workspaceRoot,
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
    if (!options.json && session.finalMessage) io.write(session.finalMessage);
    return session.status === "completed" ? 0 : session.status === "aborted" ? 130 : 1;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
