import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it.skipIf(process.platform === "win32")("terminates descendants on timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "shardcode-sandbox-"));
    const marker = join(root, "descendant.txt");
    const command = `exec 1>/dev/null 2>&1; (sleep 0.4; printf alive > '${marker}') & sleep 10`;

    const sandbox = createProcessSandbox({ isolated: true });
    const result = await sandbox.execute({ command, cwd: root, timeoutMs: 100 });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(result.exitCode).toBe(124);
    await expect(readFile(marker, "utf8")).rejects.toThrow();
  });
});
