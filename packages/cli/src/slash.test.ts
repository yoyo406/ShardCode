import { describe, expect, it } from "vitest";
import { parseInteractiveInput } from "./slash.js";

describe("interactive input", () => {
  it("parses tasks, aliases and connect without executing them", () => {
    expect(parseInteractiveInput("  Inspect the repo  ")).toEqual({
      kind: "task",
      prompt: "Inspect the repo"
    });
    expect(parseInteractiveInput("/quit")).toEqual({ kind: "command", command: { name: "exit" } });
    expect(parseInteractiveInput("/connect")).toEqual({ kind: "command", command: { name: "connect" } });
  });

  it("rejects unsafe resume ids and invalid arguments", () => {
    expect(parseInteractiveInput("/resume ../secrets")).toMatchObject({ kind: "invalid" });
    expect(parseInteractiveInput("/clear extra")).toMatchObject({ kind: "invalid" });
    expect(parseInteractiveInput("/unknown")).toMatchObject({ kind: "invalid" });
  });
});
