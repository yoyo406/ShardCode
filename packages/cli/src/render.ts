import type { ShardCodeEvent } from "@shardcode/shared";
import type { TuiTone } from "./theme.js";

export interface RenderOptions {
  style?: (text: string, tone: TuiTone) => string;
}

const ANSI_OSC = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const C1_OSC = /\u009d[^\u0007\u009c]*(?:\u0007|\u009c|\u001b\\)/g;
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_C1_CSI = /\u009b[0-?]*[ -/]*[@-~]/g;
const ANSI_SINGLE = /\u001b[@-_]/g;

export function sanitizeTerminalText(value: string): string {
  return value
    .replace(ANSI_OSC, "")
    .replace(C1_OSC, "")
    .replace(ANSI_CSI, "")
    .replace(ANSI_C1_CSI, "")
    .replace(ANSI_SINGLE, "")
    .replace(/\u001b/g, "")
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\u0080-\u009f]/g, "");
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function display(value: unknown, fallback = ""): string {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function toolDescription(data: Record<string, unknown>): string {
  const call = record(data.call);
  const input = record(call.input);
  return text(input.command) ?? text(call.name) ?? text(data.toolName) ?? "outil";
}

function eventDetail(data: Record<string, unknown>, fallback: string): string {
  const result = record(data.result);
  const error = record(result.error);
  return text(data.message) ?? text(result.output) ?? text(error.message) ?? fallback;
}

function permissionDetail(data: Record<string, unknown>): { tool: string; reason: string } {
  const result = record(data.result);
  const permission = record(result.permission);
  return {
    tool: text(result.toolName) ?? text(record(data.call).name) ?? "unknown",
    reason: text(permission.reason) ?? text(result.output) ?? text(record(result.error).message) ?? "permission required"
  };
}

function budgetDetail(value: unknown): string {
  const message = text(value);
  if (!message) return "la limite autorisée a été atteinte";
  const tokenMatch = message.match(/^token budget exceeded(.*)$/i);
  if (tokenMatch) return `la limite de tokens a été atteinte${tokenMatch[1] ?? ""}`;
  const toolMatch = message.match(/^tool[- ]call budget exceeded(.*)$/i);
  if (toolMatch) return `la limite d'appels d'outils a été atteinte${toolMatch[1] ?? ""}`;
  const timeMatch = message.match(/^wall[- ]clock budget exceeded(.*)$/i);
  if (timeMatch) return `la durée maximale a été atteinte${timeMatch[1] ?? ""}`;
  return message;
}

function sessionStatus(value: unknown): string {
  const labels: Record<string, string> = {
    completed: "réussie",
    failed: "échouée",
    aborted: "interrompue",
    pending: "en attente",
    running: "en cours"
  };
  const status = text(value)?.toLowerCase();
  return (status && labels[status]) ?? "terminée";
}

function humanLine(line: string, tone: TuiTone, options?: RenderOptions): string {
  const safeLine = sanitizeTerminalText(line);
  return options?.style?.(safeLine, tone) ?? safeLine;
}

export function renderEvent(
  event: ShardCodeEvent,
  write: (line: string) => void,
  json: boolean,
  options?: RenderOptions
): void {
  if (json) {
    write(JSON.stringify(event));
    return;
  }

  const data = event.data;
  let line: string;
  let tone: TuiTone;

  switch (event.type) {
    case "SessionStarted":
      line = "Session démarrée";
      tone = "primary";
      break;
    case "AgentStarted":
      line = "Agent démarré";
      tone = "info";
      break;
    case "AgentAborted":
      line = `Exécution interrompue : ${eventDetail(data, "la tâche a été interrompue")}`;
      tone = "warning";
      break;
    case "TurnStarted":
      line = `Tour ${display(data.turn, "0")} démarré`;
      tone = "info";
      break;
    case "TurnCompleted":
      line = `Tour ${display(data.turn, "0")} terminé`;
      tone = "info";
      break;
    case "ContextUpdated":
      line = "Contexte du projet mis à jour";
      tone = "info";
      break;
    case "ContextCompacted":
      line = `Contexte compacté (${display(data.omittedMessages, "0")} message(s) omis)`;
      tone = "info";
      break;
    case "ModelRequestStarted":
      line = "Réflexion en cours…";
      tone = "info";
      break;
    case "ModelResponseReceived": {
      const toolCallCount = typeof data.toolCallCount === "number" ? data.toolCallCount : 0;
      line = toolCallCount > 0
        ? `Réponse reçue (${toolCallCount} outil${toolCallCount === 1 ? "" : "s"} à exécuter)`
        : "Réponse reçue";
      tone = "info";
      break;
    }
    case "ToolRequested":
      line = `Exécution : ${toolDescription(data)}`;
      tone = "accent";
      break;
    case "ToolStarted":
      return;
    case "ToolCompleted":
      line = "Terminé";
      tone = "success";
      break;
    case "ToolDenied": {
      const permission = permissionDetail(data);
      line = `[permission] denied ${permission.tool}: ${permission.reason}`;
      tone = "warning";
      break;
    }
    case "ToolFailed": {
      const result = record(data.result);
      if (result.status === "denied") {
        const permission = permissionDetail(data);
        line = `[permission] denied ${permission.tool}: ${permission.reason}`;
        tone = "warning";
      } else {
        line = `Échec : ${eventDetail(data, "une erreur est survenue")}`;
        tone = "error";
      }
      break;
    }
    case "SubAgentSpawned":
      line = "Sous-agent démarré";
      tone = "accent";
      break;
    case "SubAgentCompleted":
      line = "Sous-agent terminé";
      tone = "success";
      break;
    case "TestStarted":
      line = "Tests en cours…";
      tone = "info";
      break;
    case "TestFailed":
      line = `Tests en échec : ${eventDetail(data, "la suite a échoué")}`;
      tone = "error";
      break;
    case "TestPassed":
      line = "Tests réussis";
      tone = "success";
      break;
    case "ValidationStarted":
      line = "Validation…";
      tone = "info";
      break;
    case "ValidationPassed":
      line = "Validation réussie";
      tone = "success";
      break;
    case "BudgetExceeded":
      line = `Limite atteinte : ${budgetDetail(data.message)}`;
      tone = "error";
      break;
    case "ThrashingDetected":
      line = "Arrêt : la même opération a échoué plusieurs fois";
      tone = "warning";
      break;
    case "SessionCompleted": {
      const status = display(data.status, "completed");
      line = `Session terminée (${sessionStatus(status)})`;
      tone = status === "completed" ? "success" : status === "aborted" ? "warning" : "error";
      break;
    }
    default:
      line = "Étape en cours";
      tone = "normal";
  }

  write(humanLine(line, tone, options));
}
