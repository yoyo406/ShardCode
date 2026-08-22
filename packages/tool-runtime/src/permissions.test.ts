import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PermissionRule } from "@shardcode/shared";
import { PermissionEngine } from "./permissions.js";

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "shardcode-permissions-"));
}

describe("permission engine", () => {
  it("allows reads and asks for writes in ask mode", async () => {
    const root = await workspace();
    const engine = await PermissionEngine.create({ workspaceRoot: root, mode: "ask" });

    expect(engine.check({ toolName: "read_file", risk: "read", mode: "ask", path: "README.md" }).level).toBe("allow");
    expect(engine.check({ toolName: "write_file", risk: "write", mode: "ask", path: "src/index.ts" }).level).toBe("ask");
  });

  it("allows workspace writes in acceptEdits mode", async () => {
    const root = await workspace();
    const engine = new PermissionEngine({ workspaceRoot: root, mode: "acceptEdits" });

    expect(engine.check({ toolName: "write_file", risk: "write", mode: "acceptEdits", path: "src/index.ts" }).level).toBe("allow");
    expect(engine.check({ toolName: "run_shell", risk: "shell", mode: "acceptEdits", command: "pnpm test" }).level).toBe("ask");
  });

  it("denies protected paths and workspace escapes regardless of mode", async () => {
    const root = await workspace();
    const engine = new PermissionEngine({ workspaceRoot: root, mode: "bypass", isolatedEnvironment: true });

    expect(engine.check({ toolName: "write_file", risk: "write", mode: "bypass", path: ".env" }).level).toBe("deny");
    expect(engine.check({ toolName: "write_file", risk: "write", mode: "bypass", path: ".git/config" }).level).toBe("deny");
    expect(engine.check({ toolName: "read_file", risk: "read", mode: "bypass", path: "../outside.txt" }).level).toBe("deny");
  });

  it("requires an isolated environment for bypass mode", async () => {
    const root = await workspace();
    const engine = new PermissionEngine({ workspaceRoot: root, mode: "bypass" });

    expect(engine.check({ toolName: "run_shell", risk: "shell", mode: "bypass", command: "echo unsafe" }).level).toBe("deny");
  });

  it("does not treat an omitted isolation flag as proof for bypass mode", async () => {
    const root = await workspace();
    const engine = new PermissionEngine({ workspaceRoot: root, mode: "bypass" });

    expect(engine.check({ toolName: "run_shell", risk: "shell", mode: "bypass", command: "echo unsafe" }).level).toBe("deny");
  });

  it("asks before an unscoped Git diff can disclose protected content", async () => {
    const root = await workspace();
    const engine = new PermissionEngine({ workspaceRoot: root, mode: "ask" });

    expect(engine.check({ toolName: "git_diff", risk: "git", mode: "ask" }).level).toBe("ask");
  });

  it("resolves matching rules by deny, ask, then allow priority", async () => {
    const root = await workspace();
    await mkdir(join(root, ".shardcode"));
    await writeFile(
      join(root, ".shardcode", "settings.json"),
      JSON.stringify({ rules: [{ tool: "write_file", path: "src/*", decision: "allow" }] })
    );
    await writeFile(
      join(root, ".shardcode", "settings.local.json"),
      JSON.stringify({ rules: [{ tool: "write_file", path: "src/secrets/*", decision: "deny" }] })
    );

    const engine = await PermissionEngine.create({ workspaceRoot: root, mode: "ask" });
    expect(engine.check({ toolName: "write_file", risk: "write", mode: "ask", path: "src/index.ts" }).level).toBe("allow");
    expect(engine.check({ toolName: "write_file", risk: "write", mode: "ask", path: "src/secrets/key.ts" }).level).toBe("deny");
  });

<<<<<<< HEAD
  it("ignores permission rules with invalid decisions", async () => {
=======
  it("ignores malformed rule decisions instead of bypassing the default policy", async () => {
>>>>>>> origin/main
    const root = await workspace();
    await mkdir(join(root, ".shardcode"));
    await writeFile(
      join(root, ".shardcode", "settings.json"),
<<<<<<< HEAD
      JSON.stringify({ rules: [{ tool: "write_file", decision: "execute" }] })
=======
      JSON.stringify({ rules: [{ tool: "write_file", path: "src/*", decision: "allow-by-accident" }] })
>>>>>>> origin/main
    );

    const engine = await PermissionEngine.create({ workspaceRoot: root, mode: "ask" });

    expect(engine.check({ toolName: "write_file", risk: "write", mode: "ask", path: "src/index.ts" }).level).toBe("ask");
<<<<<<< HEAD
=======

    const directEngine = new PermissionEngine({
      workspaceRoot: root,
      mode: "ask",
      settings: { rules: [{ tool: "write_file", path: "src/*", decision: "allow-by-accident" } as unknown as PermissionRule] }
    });
    expect(directEngine.check({ toolName: "write_file", risk: "write", mode: "ask", path: "src/index.ts" }).level).toBe("ask");
>>>>>>> origin/main
  });
});
