export type SlashCommandName =
  | "help"
  | "clear"
  | "status"
  | "model"
  | "permissions"
  | "resume"
  | "connect"
  | "exit";

export type SlashCommand =
  | { name: "help"; topic?: SlashCommandName }
  | { name: "model"; model?: string }
  | { name: "permissions"; mode?: "ask" | "acceptEdits" | "bypass" }
  | { name: "resume"; sessionId: string }
  | { name: Exclude<SlashCommandName, "help" | "model" | "permissions" | "resume"> };

export type InteractiveInput =
  | { kind: "task"; prompt: string }
  | { kind: "command"; command: SlashCommand }
  | { kind: "invalid"; message: string };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const COMMANDS = new Set<SlashCommandName>([
  "help", "clear", "status", "model", "permissions", "resume", "connect", "exit"
]);
const HELP_TOPICS = new Set<SlashCommandName>(COMMANDS);

function invalid(message: string): InteractiveInput {
  return { kind: "invalid", message };
}

export function parseInteractiveInput(input: string): InteractiveInput {
  const value = input.trim();
  if (!value) return invalid("input cannot be empty");
  if (!value.startsWith("/")) return { kind: "task", prompt: value };

  const parts = value.slice(1).split(/\s+/);
  const name = parts.shift()?.toLowerCase() ?? "";
  if (name === "quit") return parts.length === 0 ? { kind: "command", command: { name: "exit" } } : invalid("exit takes no arguments");
  if (!COMMANDS.has(name as SlashCommandName)) return invalid(`unknown command: ${name}`);

  switch (name as SlashCommandName) {
    case "help": {
      const requestedTopic = parts[0]?.toLowerCase();
      const topic = requestedTopic === "quit" ? "exit" : requestedTopic;
      if (parts.length > 1 || (topic && !HELP_TOPICS.has(topic as SlashCommandName))) return invalid("invalid help topic");
      return { kind: "command", command: { name: "help", ...(topic ? { topic: topic as SlashCommandName } : {}) } };
    }
    case "model":
      return parts.length <= 1 ? { kind: "command", command: { name: "model", ...(parts[0] ? { model: parts[0] } : {}) } } : invalid("model accepts at most one argument");
    case "permissions":
      return parts.length <= 1 && (!parts[0] || ["ask", "acceptedits", "bypass"].includes(parts[0].toLowerCase()))
        ? { kind: "command", command: { name: "permissions", ...(parts[0] ? { mode: parts[0].toLowerCase() === "acceptedits" ? "acceptEdits" : parts[0].toLowerCase() as "ask" | "bypass" } : {}) } }
        : invalid("invalid permissions mode");
    case "resume":
      return parts.length === 1 && ID_PATTERN.test(parts[0]!)
        ? { kind: "command", command: { name: "resume", sessionId: parts[0]! } }
        : invalid("resume requires a valid session id");
    default:
      return parts.length === 0 ? { kind: "command", command: { name } as SlashCommand } : invalid(`${name} takes no arguments`);
  }
}
