import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

export interface WorkspacePath {
  absolute: string;
  relative: string;
  withinWorkspace: boolean;
  protected: boolean;
}

function isProtectedRelativePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  const basename = segments.at(-1) ?? "";
  const protectedDirectory = segments.some((segment) =>
    [".git", ".shardcode", "secrets", "secret", "credentials"].includes(segment)
  );
  return protectedDirectory || basename === ".env" || basename.startsWith(".env.");
}

export function resolveWorkspacePath(workspaceRoot: string, requested: string): WorkspacePath {
  const root = resolve(workspaceRoot);
  const absolute = resolve(root, requested);
  const relativePath = relative(root, absolute).split(sep).join("/");
  const withinWorkspace = relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  return {
    absolute,
    relative: relativePath,
    withinWorkspace,
    protected: !withinWorkspace || isProtectedRelativePath(relativePath)
  };
}

async function nearestExistingPath(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = resolve(current, "..");
      if (parent === current) throw new Error("workspace path has no existing ancestor");
      current = parent;
    }
  }
}

async function rejectSymlinkComponents(root: string, target: string): Promise<void> {
  let current = target;
  while (current !== root && relative(root, current) !== "") {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("symbolic links are not allowed in workspace paths");
    } catch (error) {
      if (error instanceof Error && error.message === "symbolic links are not allowed in workspace paths") throw error;
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
}

export async function assertWorkspacePath(workspaceRoot: string, requested: string): Promise<string> {
  const resolved = resolveWorkspacePath(workspaceRoot, requested);
  if (!resolved.withinWorkspace || resolved.protected) throw new Error("path is protected or outside the workspace");

  const root = resolve(workspaceRoot);
  await rejectSymlinkComponents(root, resolved.absolute);
  const canonicalRoot = await realpath(root);
  const existing = await nearestExistingPath(resolved.absolute);
  const canonicalExisting = await realpath(existing);
  const canonicalRelative = relative(canonicalRoot, canonicalExisting);
  if (canonicalRelative.startsWith("..") || isAbsolute(canonicalRelative)) {
    throw new Error("path resolves outside the workspace");
  }
  return resolved.absolute;
}

export function normalizeRulePath(value: string): string {
  return normalize(value).split(sep).join("/").replace(/^\.\//, "");
}

export function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
