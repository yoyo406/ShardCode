import { describe, expect, it } from "vitest";
import { createProcessSandbox } from "./sandbox.js";

describe("process sandbox", () => {
  it("delegates approved commands to the process boundary", async () => {
    const sandbox = createProcessSandbox({
      isolated: true,
      executor: async (request) => ({
        stdout: `ran:${request.command}`,
        stderr: "",
        exitCode: 0
      })
    });

    await expect(
      sandbox.execute({ command: "pnpm test", cwd: "/repo" })
    ).resolves.toEqual({ stdout: "ran:pnpm test", stderr: "", exitCode: 0 });
  });

  it("fails closed when an unisolated process is not explicitly enabled", async () => {
    const sandbox = createProcessSandbox({ isolated: false });

    await expect(
      sandbox.execute({ command: "rm -rf /", cwd: "/repo" })
    ).rejects.toThrow("process sandbox is unavailable");
  });

  it("fails closed when isolated mode has no injected executor", async () => {
    const sandbox = createProcessSandbox({ isolated: true });

    await expect(
      sandbox.execute({ command: "echo unsafe", cwd: "/repo" })
    ).rejects.toThrow("isolated executor");
  });

  it("terminates local commands that exceed the configured timeout", async () => {
    const sandbox = createProcessSandbox({ isolated: false, allowUnisolated: true, timeoutMs: 5 });

    const result = await sandbox.execute({
      command: "node -e \"setTimeout(() => {}, 1000)\"",
      cwd: process.cwd()
    });

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("timed out");
  });

  it("bounds captured local command output", async () => {
    const sandbox = createProcessSandbox({ isolated: false, allowUnisolated: true, maxOutputBytes: 1024 });

    const result = await sandbox.execute({
      command: "head -c 2000000 /dev/zero",
      cwd: process.cwd()
    });

    expect(result.stdout.length).toBeLessThanOrEqual(1_100);
    expect(result.stderr).toContain("output truncated");
  });
});
