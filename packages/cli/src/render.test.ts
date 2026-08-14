import type { EventType, ShardCodeEvent } from "@shardcode/shared";
import { describe, expect, it } from "vitest";
import { renderEvent, sanitizeTerminalText } from "./render.js";

function event(type: EventType, data: Record<string, unknown> = {}): ShardCodeEvent {
  return {
    id: `${type}-id`,
    type,
    sessionId: "session-1",
    timestamp: "2026-08-14T00:00:00.000Z",
    data
  };
}

function render(type: EventType, data: Record<string, unknown> = {}): string[] {
  const lines: string[] = [];
  renderEvent(event(type, data), (line) => lines.push(line), false);
  return lines;
}

describe("terminal rendering", () => {
  it("removes ANSI escapes and control characters while keeping text layout", () => {
    expect(sanitizeTerminalText("\u001b[31mred\u001b[0m\u0007\nnext\r\tline")).toBe("red\nnext\tline");
  });

  it("removes C1 terminal controls as well as seven-bit escapes", () => {
    expect(sanitizeTerminalText("safe\u009b31mred\u009c\u009dtitle\u009cvisible")).toBe("saferedvisible");
  });

  it.each([
    ["SessionStarted", {}, "Session démarrée"],
    ["AgentStarted", {}, "Agent démarré"],
    ["ContextUpdated", {}, "Contexte du projet mis à jour"],
    ["ModelRequestStarted", {}, "Réflexion en cours…"],
    ["ModelResponseReceived", { toolCallCount: 2 }, "Réponse reçue (2 outils à exécuter)"],
    ["SubAgentSpawned", {}, "Sous-agent démarré"],
    ["SubAgentCompleted", {}, "Sous-agent terminé"],
    ["TestStarted", {}, "Tests en cours…"],
    ["TestFailed", { message: "la suite a échoué" }, "Tests en échec : la suite a échoué"],
    ["TestPassed", {}, "Tests réussis"],
    ["ValidationStarted", {}, "Validation…"],
    ["ValidationPassed", {}, "Validation réussie"],
    ["BudgetExceeded", { message: "token budget exceeded (4/3)" }, "Limite atteinte : la limite de tokens a été atteinte (4/3)"],
    ["ThrashingDetected", { message: "equivalent tool failure repeated 3 times" }, "Arrêt : la même opération a échoué plusieurs fois"],
    ["SessionCompleted", { status: "completed" }, "Session terminée (réussie)"]
  ] as const)("renders %s as a short human-readable message", (type, data, expected) => {
    expect(render(type, data)).toEqual([expected]);
  });

  it("shows a shell command once for the request/start event pair", () => {
    const lines: string[] = [];
    renderEvent(event("ToolRequested", {
      executionId: "execution-1",
      call: { name: "run_shell", input: { command: "pnpm test" } }
    }), (line) => lines.push(line), false);
    renderEvent(event("ToolStarted", {
      executionId: "execution-1",
      toolName: "run_shell"
    }), (line) => lines.push(line), false);

    expect(lines).toEqual(["Exécution : pnpm test"]);
  });

  it("uses the tool name when a requested call has no shell command", () => {
    expect(render("ToolRequested", {
      call: { name: "read_file", input: { path: "README.md" } }
    })).toEqual(["Exécution : read_file"]);
  });

  it("renders tool completion and failure without technical prefixes", () => {
    expect(render("ToolCompleted", { executionId: "execution-1" })).toEqual(["Terminé"]);
    expect(render("ToolFailed", { result: { output: "commande introuvable" } })).toEqual(["Échec : commande introuvable"]);
  });

  it("sanitizes human-readable event details", () => {
    expect(render("ToolFailed", { result: { output: "\u001b[31mcommande échouée\u001b[0m" } })).toEqual(["Échec : commande échouée"]);
  });

  it("does not expose unknown event type names in the human fallback", () => {
    expect(render("UnknownEvent" as EventType)).toEqual(["Étape en cours"]);
  });

  it("keeps JSON output byte-for-byte unchanged", () => {
    const input = event("ModelRequestStarted", { content: "\u001b[31mraw\u001b[0m" });
    const lines: string[] = [];

    renderEvent(input, (line) => lines.push(line), true);

    expect(lines).toEqual([JSON.stringify(input)]);
  });
});
