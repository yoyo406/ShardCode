import { describe, expect, it } from "vitest";
import { formatPermissionPrompt } from "./prompts.js";

describe("permission prompts", () => {
  it("styles permission prompts without changing their decision text", () => {
    expect(formatPermissionPrompt("run_shell: pnpm test", (text) => "<warning>" + text + "</warning>"))
      .toBe("<warning>run_shell: pnpm test [y/N]</warning>");
  });
});
