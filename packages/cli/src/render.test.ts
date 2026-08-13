import { describe, expect, it } from "vitest";
import { sanitizeTerminalText } from "./render.js";

describe("terminal rendering", () => {
  it("removes ANSI escapes and control characters while keeping text layout", () => {
    expect(sanitizeTerminalText("\u001b[31mred\u001b[0m\u0007\nnext\r\tline")).toBe("red\nnext\tline");
  });

  it("removes C1 terminal controls as well as seven-bit escapes", () => {
    expect(sanitizeTerminalText("safe\u009b31mred\u009c\u009dtitle\u009cvisible")).toBe("saferedvisible");
  });
});
