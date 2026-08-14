import { createEvent } from "@shardcode/shared";
import { describe, expect, it } from "vitest";
import { renderEvent, sanitizeTerminalText } from "./render.js";

describe("event rendering", () => {
  it("sanitizes hostile event text before applying a semantic tone", () => {
    const lines: string[] = [];
    renderEvent(
      createEvent("session-1", "ToolFailed", {
        result: { output: "\u001b[31mrm -rf\u001b[0m\nfailed" }
      }),
      (line) => lines.push(line),
      false,
      { style: (text, tone) => "<" + tone + ">" + text + "</" + tone + ">" }
    );
    expect(lines[0]).toBe("<error>Échec : rm -rf\nfailed</error>");
    expect(lines[0]).not.toContain("\u001b");
  });

  it("keeps JSON output unchanged and unstyled", () => {
    const lines: string[] = [];
    let styleCalls = 0;
    const event = createEvent("session-1", "ValidationPassed", { commands: ["pnpm test"] });
    renderEvent(event, (line) => lines.push(line), true, {
      style: () => {
        styleCalls += 1;
        return "should-not-run";
      }
    });
    expect(JSON.parse(lines[0]!)).toEqual(event);
    expect(styleCalls).toBe(0);
  });

  it("removes C1 OSC sequences and every standalone C1 control", () => {
    const standaloneC1 = String.fromCharCode(...Array.from({ length: 32 }, (_, index) => 0x80 + index));

    expect(sanitizeTerminalText(`before\u009d8;window title\u009c${standaloneC1}after`)).toBe("beforeafter");
  });
});
