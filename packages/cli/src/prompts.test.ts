import { describe, expect, it } from "vitest";
import { formatPermissionPrompt, sanitizePermissionPrompt } from "./prompts.js";

describe("permission prompts", () => {
  it("styles permission prompts without changing their decision text", () => {
    expect(formatPermissionPrompt("run_shell: pnpm test", (text) => "<warning>" + text + "</warning>"))
      .toBe("<warning>run_shell: pnpm test [y/N]</warning>");
  });

  it("removes hostile terminal controls before formatting the human prompt", () => {
    const hostile = [
      "run_shell: pnpm test",
      "\u001b[31mrm -rf\u001b[0m",
      "\u001b]0;fake approval\u0007",
      "\u009b2Jclear",
      "\u009d0;fake title\u009c",
      "\u0000\u0007\u001bX\u0080\u009f",
      "line\r\nbreak\tfield"
    ].join(" ");
    let styledText = "";

    const formatted = formatPermissionPrompt(hostile, (text) => {
      styledText = text;
      return `<warning>${text}</warning>`;
    });

    expect(styledText).toBe("run_shell: pnpm test rm -rf  clear   line⏎break⇥field [y/N]");
    expect(formatted).toBe(`<warning>${styledText}</warning>`);
    expect(formatted).not.toMatch(/[\u0000-\u001f\u007f\u0080-\u009f\u001b]/);
    expect(formatted).not.toContain("\n");
    expect(formatted).not.toContain("\t");
  });

  it("replaces semantic command line breaks and tabs with visible markers", () => {
    expect(sanitizePermissionPrompt("first\r\nsecond\rthird\nfourth\tfifth"))
      .toBe("first⏎second⏎third⏎fourth⇥fifth");
  });
});
