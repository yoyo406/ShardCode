import type { ShardCodeEvent } from "@shardcode/shared";

const ANSI_OSC = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const ANSI_C1_OSC = /\u009d[^\u0007\u009c]*(?:\u0007|\u009c)/g;
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_C1_CSI = /\u009b[0-?]*[ -/]*[@-~]/g;
const ANSI_SINGLE = /\u001b[@-_]/g;

export function sanitizeTerminalText(value: string): string {
  return value
    .replace(ANSI_OSC, "")
    .replace(ANSI_C1_OSC, "")
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

export function renderEvent(event: ShardCodeEvent, write: (line: string) => void, json: boolean): void {
  if (json) {
    write(JSON.stringify(event));
    return;
  }
  const writeHuman = (line: string): void => write(sanitizeTerminalText(line));
  const data = event.data;
  switch (event.type) {
    case "SessionStarted":
      writeHuman("Session démarrée");
      break;
    case "AgentStarted":
      writeHuman("Agent démarré");
      break;
    case "ContextUpdated":
      writeHuman("Contexte du projet mis à jour");
      break;
    case "ModelRequestStarted":
      writeHuman("Réflexion en cours…");
      break;
    case "TurnStarted":
      write(`[turn] ${String(data.turn ?? "")} started`);
      break;
    case "TurnCompleted":
      write(`[turn] ${String(data.turn ?? "")} completed`);
      break;
    case "ModelResponseReceived":
      {
        const toolCallCount = typeof data.toolCallCount === "number" ? data.toolCallCount : 0;
        writeHuman(toolCallCount > 0
          ? `Réponse reçue (${toolCallCount} outil${toolCallCount === 1 ? "" : "s"} à exécuter)`
          : "Réponse reçue");
      }
      break;
    case "ToolRequested":
      writeHuman(`Exécution : ${toolDescription(data)}`);
      break;
    case "ToolStarted":
      break;
    case "ToolCompleted":
      writeHuman("Terminé");
      break;
    case "ToolFailed":
      writeHuman(`Échec : ${eventDetail(data, "une erreur est survenue")}`);
      break;
    case "SubAgentSpawned":
      writeHuman("Sous-agent démarré");
      break;
    case "SubAgentCompleted":
      writeHuman("Sous-agent terminé");
      break;
    case "TestStarted":
      writeHuman("Tests en cours…");
      break;
    case "TestFailed":
      writeHuman(`Tests en échec : ${eventDetail(data, "la suite a échoué")}`);
      break;
    case "TestPassed":
      writeHuman("Tests réussis");
      break;
    case "ValidationStarted":
      writeHuman("Validation…");
      break;
    case "ToolDenied":
      writeHuman(`Accès refusé : ${eventDetail(data, "permission refusée")}`);
      break;
    case "ContextCompacted":
      writeHuman(`Contexte compacté (${String(data.omittedMessages ?? 0)} message(s) omis)`);
      break;
    case "AgentAborted":
      writeHuman(`Exécution interrompue : ${eventDetail(data, "la tâche a été interrompue")}`);
      break;
    case "ValidationPassed":
      writeHuman("Validation réussie");
      break;
    case "BudgetExceeded":
      writeHuman(`Limite atteinte : ${budgetDetail(data.message)}`);
      break;
    case "ThrashingDetected":
      writeHuman("Arrêt : la même opération a échoué plusieurs fois");
      break;
    case "SessionCompleted":
      writeHuman(`Session terminée (${sessionStatus(data.status)})`);
      break;
    default:
      writeHuman("Étape en cours");
  }
}
