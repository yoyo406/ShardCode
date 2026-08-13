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
});
