import type {
  PermissionDecision,
  PermissionRequest,
  ProviderConfig,
  Session,
  ShardCodeEvent,
  StoredProviderConnection
} from "@shardcode/shared";
import { resolve } from "node:path";
import { ContextEngine } from "@shardcode/context-engine";
import { MemoryStore } from "@shardcode/memory";
import {
  createProvider,
  createScriptedProvider,
  discoverModels,
  getProviderDefinition,
  PROVIDER_CATALOG
} from "@shardcode/providers";
import { AgentRuntime, JsonSessionStore } from "@shardcode/runtime";
import { FileStorage, ToolRuntime } from "@shardcode/tool-runtime";
import { parseArgs, HELP_TEXT, type CliOptions, type CliProvider } from "./args.js";
import { askForPermission } from "./prompts.js";
import { renderEvent } from "./render.js";
import { ProviderStore } from "./provider-store.js";
import {
  createDefaultTuiTerminal,
  runInteractiveTui,
  type InteractiveTaskRequest,
  type TuiConnectionIO,
  type TuiConnectionResult,
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
  fetch?: typeof globalThis.fetch;
}

function defaultIO(): CliIO {
  return {
    write: (line) => process.stdout.write(`${line}\n`),
    error: (line) => process.stderr.write(`${line}\n`),
    ask: async (question) => askForPermission(question),
    tui: createDefaultTuiTerminal(),
    cwd: process.cwd(),
    env: process.env
  };
}

function defaultModel(provider: CliProvider): string {
  switch (provider) {
    case "anthropic": return "claude-3-5-sonnet-20241022";
    case "anthropic-claude": return "claude-sonnet-4-6";
    case "gemini": return "gemini-2.0-flash";
    case "google-gemini": return "gemini-2.5-flash";
    case "openai-codex": return "codex-mini-latest";
    case "mistral": return "mistral-large-latest";
    case "opencode-zen": return "gpt-5.4";
    case "opencode-go": return "kimi-k2.5";
    case "cline": return "anthropic/claude-sonnet-4-6";
    case "kilo-code": return "anthropic/claude-sonnet-4-5";
    case "scripted": return "scripted-local";
    case "openai": return "gpt-4o-mini";
  }
}

function environmentKey(provider: CliProvider, env: Record<string, string | undefined>): string | undefined {
  let names: string[];
  switch (provider) {
    case "openai": names = ["OPENAI_API_KEY"]; break;
    case "openai-codex": names = ["CODEX_API_KEY", "OPENAI_API_KEY"]; break;
    case "anthropic":
    case "anthropic-claude": names = ["ANTHROPIC_API_KEY"]; break;
    case "gemini":
    case "google-gemini": names = ["GEMINI_API_KEY", "GOOGLE_API_KEY"]; break;
    case "mistral": names = ["MISTRAL_API_KEY"]; break;
    case "opencode-zen":
    case "opencode-go": names = ["OPENCODE_API_KEY"]; break;
    case "cline": names = ["CLINE_API_KEY"]; break;
    case "kilo-code": names = ["KILO_API_KEY"]; break;
    case "scripted": return undefined;
  }
  return names.map((name) => env[name]).find((value): value is string => Boolean(value));
}

function buildProvider(
  options: CliOptions,
  env: Record<string, string | undefined>,
  fetcher: typeof globalThis.fetch | undefined,
  connection?: StoredProviderConnection
) {
  const provider = connection?.providerId ?? options.provider;
  const model = options.modelExplicit ? options.model : connection?.modelId ?? defaultModel(provider);
  if (provider === "scripted") {
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
  const apiKey = connection?.apiKey ?? environmentKey(provider, env);
  const config: ProviderConfig = {
    provider,
    model,
    ...(apiKey ? { apiKey } : {}),
    ...(connection?.baseUrl ? { baseUrl: connection.baseUrl } : {}),
    ...(connection?.protocol ? { protocol: connection.protocol } : {}),
    ...(connection?.verification ? { verification: connection.verification } : {}),
    ...(fetcher ? { fetch: fetcher } : {})
  };
  return createProvider(config);
}

function workspaceRootFor(io: CliIO): string {
  return resolve(io.env.SHARDCODE_WORKSPACE_ROOT ?? io.env.INIT_CWD ?? io.cwd);
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

async function executeTask(
  options: TaskCliOptions,
  io: CliIO,
  providerStore: ProviderStore
): Promise<TaskExecutionResult> {
  try {
    const workspaceRoot = workspaceRootFor(io);
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
    let resumedSession: Session | undefined;
    if (options.command === "resume" && options.sessionId && !options.providerExplicit) {
      resumedSession = await sessionStore.load(options.sessionId);
      if (resumedSession) {
        providerOptions = {
          ...options,
          provider: resumedSession.provider as CliProvider,
          model: resumedSession.model,
          modelExplicit: true
        };
      }
    }
    let storedConnection: StoredProviderConnection | undefined;
    if (!options.providerExplicit) {
      const config = await providerStore.load();
      storedConnection = resumedSession
        ? config.connections.find((connection) => connection.providerId === providerOptions.provider)
        : config.connections.find((connection) => connection.providerId === config.activeProviderId);
    }
    const provider = buildProvider(providerOptions, io.env, io.fetch, storedConnection);
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
      maxContextCharacters: options.maxContextCharacters,
      onEvent: async (event: ShardCodeEvent) => renderEvent(event, io.write, options.json)
    });
    const onSigint = () => runtime.abort();
    process.once("SIGINT", onSigint);
    let session: Session;
    try {
      session = options.command === "run"
        ? await runtime.run(options.prompt ?? "")
        : await runtime.resume(options.sessionId ?? "");
    } finally {
      process.removeListener("SIGINT", onSigint);
    }
    if (storedConnection?.verification === "unverified" && session.status !== "failed" && session.status !== "aborted") {
      await providerStore.markVerified(storedConnection.providerId).catch(() => undefined);
    }
    if (!options.json && session.status === "completed" && session.finalMessage) io.write(session.finalMessage);
    return {
      exitCode: session.status === "completed" ? 0 : session.status === "aborted" ? 130 : 1,
      session
    };
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return { exitCode: 1 };
  }
}

async function connectProvider(
  io: CliIO,
  providerStore: ProviderStore,
  tuiIO: TuiConnectionIO
): Promise<TuiConnectionResult | undefined> {
  const providerIndex = await tuiIO.select(
    "Choose an AI provider",
    PROVIDER_CATALOG.map((definition) => ({ id: definition.id, label: definition.label }))
  );
  if (providerIndex === undefined) return undefined;
  const definition = PROVIDER_CATALOG[providerIndex];
  if (!definition) return undefined;

  const enteredKey = await tuiIO.secret(`${definition.label} API key (hidden): `);
  const apiKey = enteredKey?.trim();
  if (!apiKey) return undefined;

  const discovery = await discoverModels(
    definition.id,
    apiKey,
    io.fetch ? { fetch: io.fetch } : {}
  );
  if (discovery.models.length === 0) throw new Error(`${definition.label} returned no usable models.`);
  const modelIndex = await tuiIO.select(
    `${definition.label} models`,
    discovery.models.map((model) => ({ id: model.id, label: model.label }))
  );
  if (modelIndex === undefined) return undefined;
  const model = discovery.models[modelIndex];
  if (!model) return undefined;

  const connection: StoredProviderConnection = {
    providerId: model.providerId,
    apiKey,
    modelId: model.id,
    protocol: model.protocol,
    ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
    verification: discovery.verification,
    updatedAt: new Date().toISOString()
  };
  await providerStore.save(connection);
  return {
    providerId: model.providerId,
    providerLabel: definition.label,
    modelId: model.id,
    modelLabel: model.label
  };
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
  const providerStore = new ProviderStore({ env: io.env });
  if (options.command === "interactive") {
    if (options.json) {
      io.error("--json cannot be used with interactive mode.");
      return 2;
    }
    const terminal = io.tui ?? createDefaultTuiTerminal();
    let activeConnection: StoredProviderConnection | undefined;
    try {
      activeConnection = options.providerExplicit ? undefined : await providerStore.loadActive();
    } catch (error) {
      io.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
    return runInteractiveTui({
      terminal,
      workspaceRoot: workspaceRootFor(io),
      info: {
        provider: activeConnection?.providerId ?? options.provider,
        model: activeConnection?.modelId ?? (options.modelExplicit ? options.model : defaultModel(options.provider)),
        permissionMode: options.permissionMode,
        isolatedEnvironment: options.isolatedEnvironment
      },
      connect: (tuiIO) => connectProvider(io, providerStore, tuiIO),
      execute: async (request: InteractiveTaskRequest, tuiIO): Promise<TuiExecutionResult> => {
        const taskOptions: TaskCliOptions = request.kind === "run"
          ? { ...options, command: "run", prompt: request.prompt }
          : { ...options, command: "resume", sessionId: request.sessionId };
        const result = await executeTask(
          taskOptions,
          { ...io, write: tuiIO.write, error: tuiIO.error, ask: tuiIO.ask },
          providerStore
        );
        return {
          exitCode: result.exitCode,
          ...(result.session ? { session: sessionSnapshot(result.session) } : {})
        };
      }
    });
  }
  if (options.command === "run" || options.command === "resume") {
    return (await executeTask(asTaskOptions(options), io, providerStore)).exitCode;
  }
  io.error(`Unsupported CLI command: ${options.command}`);
  return 2;
}
