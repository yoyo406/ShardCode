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

  it("removes C1 OSC sequences and every standalone C1 control", () => {
    const standaloneC1 = String.fromCharCode(...Array.from({ length: 32 }, (_, index) => 0x80 + index));

    expect(sanitizeTerminalText(`before\u009d8;window title\u009c${standaloneC1}after`)).toBe("beforeafter");
    expect(sanitizeTerminalText("safe\u009b31mred\u009c\u009dtitle\u009cvisible")).toBe("saferedvisible");
  });

  it.each([
    ["SessionStarted", {}, "Session démarrée"],
    ["AgentStarted", {}, "Agent démarré"],
    ["ContextUpdated", {}, "Contexte du projet mis à jour"],
    ["ContextCompacted", { omittedMessages: 3 }, "Contexte compacté (3 message(s) omis)"],
    ["ModelRequestStarted", {}, "Réflexion en cours…"],
    ["ModelResponseReceived", { toolCallCount: 2 }, "Réponse reçue (2 outils à exécuter)"],
    ["SubAgentSpawned", {}, "Sous-agent démarré"],
    ["SubAgentCompleted", {}, "Sous-agent terminé"],
    ["TestStarted", {}, "Tests en cours…"],
    ["TestFailed", { message: "la suite a échoué" }, "Tests en échec : la suite a échoué"],
    ["TestPassed", {}, "Tests réussis"],
    ["ValidationStarted", {}, "Validation…"],
    ["ValidationPassed", {}, "Validation réussie"],
    ["AgentAborted", { message: "cancelled" }, "Exécution interrompue : cancelled"],
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

  it("renders completion, failure, and explicit permission markers", () => {
    expect(render("ToolCompleted", { executionId: "execution-1" })).toEqual(["Terminé"]);
    expect(render("ToolFailed", { result: { output: "commande introuvable" } })).toEqual(["Échec : commande introuvable"]);
    expect(render("ToolDenied", {
      result: { toolName: "run_shell", status: "denied", output: "review first", permission: { reason: "review first" } }
    })).toEqual(["[permission] denied run_shell: review first"]);
  });

  it("sanitizes hostile event text before applying a semantic tone", () => {
    const lines: string[] = [];
    renderEvent(
      event("ToolFailed", { result: { output: "\u001b[31mrm -rf\u001b[0m\nfailed" } }),
      (line) => lines.push(line),
      false,
      { style: (text, tone) => `<${tone}>${text}</${tone}>` }
    );

    expect(lines[0]).toBe("<error>Échec : rm -rf\nfailed</error>");
    expect(lines[0]).not.toContain("\u001b");
  });

  it("does not expose unknown event type names in the human fallback", () => {
    expect(render("UnknownEvent" as EventType)).toEqual(["Étape en cours"]);
  });

  it("keeps JSON output byte-for-byte unchanged and unstyled", () => {
    const input = event("ModelRequestStarted", { content: "\u001b[31mraw\u001b[0m" });
    const lines: string[] = [];
    let styleCalls = 0;

    renderEvent(input, (line) => lines.push(line), true, {
      style: () => {
        styleCalls += 1;
        return "should-not-run";
      }
    });

    expect(lines).toEqual([JSON.stringify(input)]);
    expect(styleCalls).toBe(0);
  });
});
