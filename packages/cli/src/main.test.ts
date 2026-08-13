import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { JsonSessionStore } from "@shardcode/runtime";
import { FileStorage } from "@shardcode/tool-runtime";
import { runCli, type CliIO } from "./main.js";

function io(overrides: Partial<Pick<CliIO, "cwd" | "env">> = {}): CliIO & { output: string[]; errors: string[] } {
  const value = {
    output: [] as string[],
    errors: [] as string[],
    write: (line: string) => value.output.push(line),
    error: (line: string) => value.errors.push(line),
    ask: async () => true,
    cwd: overrides.cwd ?? process.cwd(),
    env: overrides.env ?? {}
  };
  return value;
}

describe("CLI lifecycle", () => {
  it("runs a scripted provider without a network request", async () => {
    const testIo = io();
    const exitCode = await runCli(["run", "Run the checks", "--provider", "scripted", "--permission-mode", "bypass", "--isolated-environment"], testIo);

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

  it("uses pnpm's invocation root instead of the CLI package directory", async () => {
    const repositoryRoot = process.cwd();
    const testIo = io({
      cwd: join(repositoryRoot, "packages/cli"),
      env: { INIT_CWD: repositoryRoot }
    });

    const exitCode = await runCli(["run", "Use the repository root", "--provider", "scripted", "--permission-mode", "bypass", "--isolated-environment"], testIo);

    expect(exitCode).toBe(0);
    const sessionId = testIo.output.find((line) => line.startsWith("[session] started "))?.split(" ").at(-1);
    expect(sessionId).toBeTruthy();
    const session = await new JsonSessionStore(new FileStorage(join(repositoryRoot, ".shardcode"))).load(sessionId ?? "");
    expect(session?.workspaceRoot).toBe(repositoryRoot);
  });
});
