import { describe, expect, it } from "vitest";
import { detectTuiCapabilities, styleTuiText } from "./theme.js";

describe("TUI theme", () => {
  it("detects truecolor and the dark OpenCode palette", () => {
    const capabilities = detectTuiCapabilities(true, { COLORTERM: "truecolor", COLORFGBG: "15;0" });
    expect(capabilities).toEqual({ colorMode: "truecolor", theme: "dark" });
    expect(styleTuiText("ShardCode", "primary", capabilities)).toBe("\u001b[38;2;250;178;131mShardCode\u001b[39m");
  });

  it("falls back to 256, 16 and no color in order", () => {
    expect(detectTuiCapabilities(true, { TERM: "xterm-256color" }).colorMode).toBe("ansi256");
    expect(styleTuiText("ok", "primary", { colorMode: "ansi256", theme: "dark" })).toBe("\u001b[38;5;217mok\u001b[39m");
    expect(styleTuiText("ok", "primary", { colorMode: "ansi16", theme: "dark" })).toContain("\u001b[9");
    expect(styleTuiText("ok", "primary", { colorMode: "none", theme: "dark" })).toBe("ok");
  });

  it("detects a light terminal and disables color for non-TTY", () => {
    expect(detectTuiCapabilities(true, { COLORFGBG: "0;15" }).theme).toBe("light");
    expect(detectTuiCapabilities(false, { COLORTERM: "truecolor" })).toEqual({ colorMode: "none", theme: "dark" });
  });
});
