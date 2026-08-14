import { describe, expect, it } from "vitest";
import { runCli, writeFinalMessage, type CliIO } from "./main.js";

function io(): CliIO & { output: string[]; errors: string[] } {
  const value = {
    output: [] as string[],
    errors: [] as string[],
    write: (line: string) => value.output.push(line),
    error: (line: string) => value.errors.push(line),
    ask: async () => true,
    cwd: process.cwd(),
    env: {}
  };
  return value;
}

describe("CLI lifecycle", () => {
  it("runs a scripted provider without a network request", async () => {
    const testIo = io();
    const exitCode = await runCli(["run", "Run the checks", "--provider", "scripted", "--permission-mode", "acceptEdits"], testIo);

    expect(exitCode).toBe(0);
    expect(testIo.output.some((line) => line.includes("[session] completed"))).toBe(true);
    expect(testIo.output.some((line) => line.includes("completed"))).toBe(true);
  });

  it("returns a usage error for an incomplete resume command", async () => {
    const testIo = io();
    const exitCode = await runCli(["resume"], testIo);

    expect(exitCode).toBe(2);
    expect(testIo.errors.join("\n")).toContain("session id");
  });

  it("sanitizes final model output at the human output sink", () => {
    const testIo = io();

    writeFinalMessage(testIo, "\u009d8;window title\u009c\u001b[31mfinal\u001b[0m", false);

    expect(testIo.output).toEqual(["final"]);
  });

  it("does not write the final model output in JSON mode", () => {
    const testIo = io();

    writeFinalMessage(testIo, "\u001b[31mfinal\u001b[0m", true);

    expect(testIo.output).toEqual([]);
  });
});
