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
    expect(styleTuiText("ok", "primary", { colorMode: "ansi256", theme: "dark" })).toBe("\u001b[38;5;216mok\u001b[39m");
    expect(styleTuiText("ok", "info", { colorMode: "ansi16", theme: "dark" })).toBe("\u001b[36mok\u001b[39m");
    expect(styleTuiText("ok", "primary", { colorMode: "none", theme: "dark" })).toBe("ok");
  });

  it("detects a light terminal and disables color for non-TTY", () => {
    expect(detectTuiCapabilities(true, { COLORFGBG: "0;15" }).theme).toBe("light");
    expect(styleTuiText("light", "primary", { colorMode: "truecolor", theme: "light" })).toBe("\u001b[38;2;59;125;216mlight\u001b[39m");
    expect(detectTuiCapabilities(false, { COLORTERM: "truecolor" })).toEqual({ colorMode: "none", theme: "dark" });
  });

  it("detects 24-bit color", () => {
    expect(detectTuiCapabilities(true, { COLORTERM: "24bit" })).toEqual({ colorMode: "truecolor", theme: "dark" });
  });

  it("chooses the nearest grayscale candidate for a near-gray tone", () => {
    expect(styleTuiText("gray", "normal", { colorMode: "ansi256", theme: "dark" })).toBe("\u001b[38;5;255mgray\u001b[39m");
  });

  it("uses the nearest ANSI-16 color without luminance substitution", () => {
    expect(styleTuiText("info", "info", { colorMode: "ansi16", theme: "dark" })).toBe("\u001b[36minfo\u001b[39m");
  });

  it("resets foreground styling for every color mode", () => {
    expect(styleTuiText("x", "primary", { colorMode: "truecolor", theme: "dark" })).toMatch(/\u001b\[39m$/);
    expect(styleTuiText("x", "primary", { colorMode: "ansi256", theme: "dark" })).toMatch(/\u001b\[39m$/);
    expect(styleTuiText("x", "primary", { colorMode: "ansi16", theme: "dark" })).toMatch(/\u001b\[39m$/);
    expect(styleTuiText("x", "primary", { colorMode: "none", theme: "dark" })).toBe("x");
  });
});
