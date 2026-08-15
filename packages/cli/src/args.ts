export type CliCommand = "interactive" | "run" | "resume" | "help";
export type CliProvider = "openai" | "anthropic" | "gemini" | "scripted";
export type CliPermissionMode = "ask" | "acceptEdits" | "bypass";

export interface CliOptions {
  command: CliCommand;
  prompt?: string;
  sessionId?: string;
  provider: CliProvider;
  providerExplicit: boolean;
  model: string;
  modelExplicit: boolean;
  permissionMode: CliPermissionMode;
  maxTokens: number;
  maxToolCalls: number;
  maxWallClockSeconds: number;
  json: boolean;
  isolatedEnvironment: boolean;
}

function defaults(): Omit<CliOptions, "command" | "prompt" | "sessionId"> {
  return {
    provider: DEFAULTS.provider,
    providerExplicit: false,
    model: DEFAULTS.model,
    modelExplicit: false,
    permissionMode: DEFAULTS.permissionMode,
    maxTokens: DEFAULTS.maxTokens,
    maxToolCalls: DEFAULTS.maxToolCalls,
    maxWallClockSeconds: DEFAULTS.maxWallClockSeconds,
    json: false,
    isolatedEnvironment: false
  };
}

const DEFAULTS = {
  provider: "openai" as const,
  model: "gpt-4o-mini",
  permissionMode: "ask" as const,
  maxTokens: 100_000,
  maxToolCalls: 100,
  maxWallClockSeconds: 1_800
};

function numberOption(name: string, value: string | undefined): number {
  if (value === undefined || value.length === 0) throw new Error(`${name} requires a value`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nextValue(argv: string[], index: number, option: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return [value, index + 1];
}

export function parseArgs(argv: string[]): CliOptions {
  const first = argv[0];
  if (first === "--help" || first === "-h" || first === "help") {
    return {
      command: "help",
      ...defaults()
    };
  }

  const command = first === "run" || first === "resume" ? first : "interactive";
  const optionStart = command === "interactive" ? 0 : 1;

  const positional: string[] = [];
  let { provider, providerExplicit, model, modelExplicit, permissionMode, maxTokens, maxToolCalls, maxWallClockSeconds, json, isolatedEnvironment } = defaults();

  for (let index = optionStart; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;
    if (argument === "-h") {
      return {
        command: "help",
        provider,
        providerExplicit,
        model,
        modelExplicit,
        permissionMode,
        maxTokens,
        maxToolCalls,
        maxWallClockSeconds,
        json,
        isolatedEnvironment
      };
    }
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    switch (argument) {
      case "--provider": {
        const [value, next] = nextValue(argv, index, argument);
        if (!(["openai", "anthropic", "gemini", "scripted"] as string[]).includes(value)) throw new Error(`unsupported provider: ${value}`);
        provider = value as CliProvider;
        providerExplicit = true;
        index = next;
        break;
      }
      case "--model": {
        const [value, next] = nextValue(argv, index, argument);
        model = value;
        modelExplicit = true;
        index = next;
        break;
      }
      case "--permission-mode": {
        const [value, next] = nextValue(argv, index, argument);
        if (!(["ask", "acceptEdits", "bypass"] as string[]).includes(value)) throw new Error(`unsupported permission mode: ${value}`);
        permissionMode = value as CliPermissionMode;
        index = next;
        break;
      }
      case "--max-tokens": {
        const [value, next] = nextValue(argv, index, argument);
        maxTokens = numberOption(argument, value);
        index = next;
        break;
      }
      case "--max-tool-calls": {
        const [value, next] = nextValue(argv, index, argument);
        maxToolCalls = numberOption(argument, value);
        index = next;
        break;
      }
      case "--max-wall-clock-seconds": {
        const [value, next] = nextValue(argv, index, argument);
        maxWallClockSeconds = numberOption(argument, value);
        index = next;
        break;
      }
      case "--json":
        json = true;
        break;
      case "--isolated-environment":
        isolatedEnvironment = true;
        break;
      case "--help":
        return {
          command: "help",
          provider,
          providerExplicit,
          model,
          modelExplicit,
          permissionMode,
          maxTokens,
          maxToolCalls,
          maxWallClockSeconds,
          json,
          isolatedEnvironment
        };
      default:
        throw new Error(`unknown option: ${argument}`);
    }
  }

  if (command === "run" && positional.length === 0) throw new Error("run requires a task prompt");
  if (command === "resume" && positional.length === 0) throw new Error("resume requires a session id");
  const resolvedCommand = command === "interactive" && positional.length > 0 ? "run" : command;
  return {
    command: resolvedCommand,
    ...(resolvedCommand === "run" ? { prompt: positional.join(" ") } : resolvedCommand === "resume" ? { sessionId: positional[0]! } : {}),
    provider,
    providerExplicit,
    model,
    modelExplicit,
    permissionMode,
    maxTokens,
    maxToolCalls,
    maxWallClockSeconds,
    json,
    isolatedEnvironment
  };
}

export const HELP_TEXT = `ShardCode - autonomous coding CLI

Usage:
  shard [options]                         interactive TUI (no command)
  shardcode [options]                     interactive TUI (no command)
  shard "task description" [options]      run a task directly
  shardcode "task description" [options]  run a task directly
  shardcode run "task description" [options]
  shardcode resume <session-id> [options]

Options:
  --provider openai|anthropic|gemini|scripted
  --model <model>
  --permission-mode ask|acceptEdits|bypass
  --max-tokens <number>
  --max-tool-calls <number>
  --max-wall-clock-seconds <number>
  --isolated-environment   required for bypass mode
  --json                    render JSONL events
  --help`;
