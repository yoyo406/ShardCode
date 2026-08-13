import { describe, expect, it } from "vitest";
import { formatSlashHelp, parseInteractiveInput } from "./slash.js";

describe("interactive slash commands", () => {
  it("keeps ordinary text as a task prompt", () => {
    expect(parseInteractiveInput("  Implement OAuth  ")).toEqual({
      kind: "task",
      prompt: "Implement OAuth"
    });
  });

  it("normalizes command names and aliases", () => {
    expect(parseInteractiveInput("/HELP model")).toEqual({
      kind: "command",
      command: { name: "help", target: "model" }
    });
    expect(parseInteractiveInput("/quit")).toEqual({
      kind: "command",
      command: { name: "exit" }
    });
  });

  it("parses a safe resume session id", () => {
    expect(parseInteractiveInput("/resume abc-123")).toEqual({
      kind: "command",
      command: { name: "resume", sessionId: "abc-123" }
    });
  });

  it("parses /connect as a local provider setup command", () => {
    expect(parseInteractiveInput("/connect")).toEqual({
      kind: "command",
      command: { name: "connect" }
    });
    expect(parseInteractiveInput("/connect extra")).toMatchObject({ kind: "invalid" });
    expect(formatSlashHelp("connect")).toContain("/connect");
  });

  it("rejects empty input, unknown commands, bad arguments, and unsafe ids", () => {
    expect(parseInteractiveInput(" ")).toEqual({
      kind: "invalid",
      message: "A task description is required."
    });
    expect(parseInteractiveInput("/unknown")).toMatchObject({ kind: "invalid" });
    expect(parseInteractiveInput("/clear extra")).toMatchObject({ kind: "invalid" });
    expect(parseInteractiveInput("/resume ../secrets")).toMatchObject({ kind: "invalid" });
    expect(parseInteractiveInput("/resume a/b")).toMatchObject({ kind: "invalid" });
  });

  it("renders focused and complete help", () => {
    expect(formatSlashHelp("status")).toContain("/status");
    expect(formatSlashHelp("status")).not.toContain("/resume <session-id>");
    expect(formatSlashHelp()).toContain("/resume <session-id>");
    expect(formatSlashHelp()).toContain("/quit");
    expect(formatSlashHelp("nope")).toContain("Unknown slash command");
  });
});
