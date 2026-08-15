export interface SlashCommandDefinition {
  readonly name: SlashCommandName;
  readonly usage: string;
  readonly description: string;
  readonly aliases?: readonly string[];
}

export type SlashCommandName =
  | "help"
  | "clear"
  | "status"
  | "model"
  | "permissions"
  | "resume"
  | "connect"
  | "exit";

export const SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  { name: "help", usage: "/help [command]", description: "Show slash command help." },
  { name: "clear", usage: "/clear", description: "Clear the TUI event history." },
  { name: "status", usage: "/status", description: "Show the last task/session status." },
  { name: "model", usage: "/model [model]", description: "Show the configured provider and model (read-only)." },
  { name: "permissions", usage: "/permissions [mode]", description: "Show permission and isolation settings (read-only)." },
  { name: "resume", usage: "/resume <session-id>", description: "Resume a persisted session." },
  { name: "connect", usage: "/connect", description: "Connect an AI provider and choose its default model." },
  { name: "exit", usage: "/exit", description: "Leave the interactive TUI.", aliases: ["quit"] }
] as const;

export type SlashCommand =
  | { name: "help"; target?: SlashCommandName }
  | { name: "model"; model?: string }
  | { name: "permissions"; mode?: "ask" | "acceptEdits" | "bypass" }
  | { name: "resume"; sessionId: string }
  | { name: Exclude<SlashCommandName, "help" | "model" | "permissions" | "resume"> };

export type ParsedInteractiveInput =
  | { kind: "task"; prompt: string }
  | { kind: "command"; command: SlashCommand }
  | { kind: "invalid"; message: string };

export type InteractiveInput = ParsedInteractiveInput;

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function invalid(message: string): ParsedInteractiveInput {
  return { kind: "invalid", message };
}

function commandDefinition(value: string): SlashCommandDefinition | undefined {
  const normalized = value.toLowerCase();
  return SLASH_COMMANDS.find((definition) =>
    definition.name === normalized || definition.aliases?.includes(normalized)
  );
}

function invalidArguments(usage: string): ParsedInteractiveInput {
  return invalid(`Usage: ${usage}`);
}

export function parseInteractiveInput(input: string): ParsedInteractiveInput {
  const trimmed = input.trim();
  if (!trimmed) return invalid("A task description is required.");
  if (!trimmed.startsWith("/")) return { kind: "task", prompt: trimmed };

  const tokens = trimmed.slice(1).split(/\s+/);
  const rawName = tokens.shift()?.toLowerCase() ?? "";
  if (!rawName) return invalid("Slash commands need a name. Type /help for available commands.");

  const definition = commandDefinition(rawName);
  if (!definition) return invalid(`Unknown slash command: /${rawName}. Type /help for available commands.`);

  switch (definition.name) {
    case "help": {
      if (tokens.length > 1) return invalidArguments(definition.usage);
      const requested = tokens[0]?.toLowerCase();
      if (!requested) return { kind: "command", command: { name: "help" } };
      const target = commandDefinition(requested);
      if (!target) return invalid(`Unknown slash command: /${requested}. Type /help for available commands.`);
      return { kind: "command", command: { name: "help", target: target.name } };
    }
    case "model":
      return tokens.length <= 1
        ? { kind: "command", command: { name: "model", ...(tokens[0] ? { model: tokens[0] } : {}) } }
        : invalidArguments(definition.usage);
    case "permissions": {
      const requested = tokens[0]?.toLowerCase();
      if (tokens.length > 1 || (requested && !["ask", "acceptedits", "bypass"].includes(requested))) {
        return invalidArguments(definition.usage);
      }
      const mode = requested === "acceptedits" ? "acceptEdits" : requested as "ask" | "bypass" | undefined;
      return { kind: "command", command: { name: "permissions", ...(mode ? { mode } : {}) } };
    }
    case "resume": {
      const sessionId = tokens[0];
      return tokens.length === 1 && sessionId && SAFE_SESSION_ID.test(sessionId)
        ? { kind: "command", command: { name: "resume", sessionId } }
        : invalidArguments(definition.usage);
    }
    case "clear":
    case "status":
    case "connect":
    case "exit":
      return tokens.length === 0
        ? { kind: "command", command: { name: definition.name } }
        : invalidArguments(definition.usage);
  }
}

export function formatSlashHelp(command?: string): string {
  if (command) {
    const definition = commandDefinition(command);
    if (!definition) return `Unknown slash command: /${command}. Type /help for available commands.`;
    const aliasText = definition.aliases?.map((alias) => `/${alias}`).join(", ");
    return [
      definition.usage,
      definition.description,
      ...(aliasText ? [`Alias: ${aliasText}`] : [])
    ].join("\n");
  }

  return [
    "Available slash commands:",
    ...SLASH_COMMANDS.map((definition) => {
      const aliasText = definition.aliases?.map((alias) => `/${alias}`).join(", ");
      return `  ${definition.usage}${aliasText ? ` (alias: ${aliasText})` : ""} — ${definition.description}`;
    }),
    "",
    "Any input that does not start with / is sent as a task."
  ].join("\n");
}
