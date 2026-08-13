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
  | "exit";

export const SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  { name: "help", usage: "/help [command]", description: "Show slash command help." },
  { name: "clear", usage: "/clear", description: "Clear the TUI event history." },
  { name: "status", usage: "/status", description: "Show the last task/session status." },
  { name: "model", usage: "/model", description: "Show the configured provider and model." },
  { name: "permissions", usage: "/permissions", description: "Show permission and isolation settings." },
  { name: "resume", usage: "/resume <session-id>", description: "Resume a persisted session." },
  { name: "exit", usage: "/exit", description: "Leave the interactive TUI.", aliases: ["quit"] }
] as const;

export type SlashCommand =
  | { name: "help"; target?: string }
  | { name: "clear" }
  | { name: "status" }
  | { name: "model" }
  | { name: "permissions" }
  | { name: "resume"; sessionId: string }
  | { name: "exit" };

export type ParsedInteractiveInput =
  | { kind: "task"; prompt: string }
  | { kind: "command"; command: SlashCommand }
  | { kind: "invalid"; message: string };

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

function invalidArguments(name: string, usage: string): ParsedInteractiveInput {
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

  const args = tokens;
  switch (definition.name) {
    case "help": {
      if (args.length > 1) return invalidArguments("help", definition.usage);
      const target = args[0]?.toLowerCase();
      if (target && !commandDefinition(target)) {
        return invalid(`Unknown slash command: /${target}. Type /help for available commands.`);
      }
      return target ? { kind: "command", command: { name: "help", target } } : { kind: "command", command: { name: "help" } };
    }
    case "resume": {
      const sessionId = args[0];
      if (args.length !== 1 || !sessionId || !SAFE_SESSION_ID.test(sessionId)) {
        return invalidArguments("resume", definition.usage);
      }
      return { kind: "command", command: { name: "resume", sessionId } };
    }
    case "clear":
    case "status":
    case "model":
    case "permissions":
    case "exit":
      return args.length === 0
        ? { kind: "command", command: { name: definition.name } }
        : invalidArguments(definition.name, definition.usage);
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
