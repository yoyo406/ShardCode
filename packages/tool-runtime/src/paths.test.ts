import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertWorkspacePath, resolveWorkspacePath } from "./paths.js";

describe("workspace path protection", () => {
  it("protects sensitive names at every path depth", async () => {
    const root = await mkdtemp(join(tmpdir(), "shardcode-paths-"));
    const protectedPaths = [
      "config/secrets.json",
      "config/secret.json",
      "config/credentials.json",
      "src/secret/token.txt",
      "src/nested/.git/config"
    ];

    for (const requested of protectedPaths) {
      expect(resolveWorkspacePath(root, requested).protected, requested).toBe(true);
      await expect(assertWorkspacePath(root, requested), requested).rejects.toThrow("path is protected");
    }

    expect(resolveWorkspacePath(root, "config/settings.json").protected).toBe(false);
  });
});
