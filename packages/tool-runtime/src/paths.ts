import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";

export interface WorkspacePath {
  absolute: string;
  relative: string;
  withinWorkspace: boolean;
  protected: boolean;
}

function isProtectedRelativePath(value: string): boolean {
  const segments = value.split(/[\\/]+/).filter(Boolean);
  const first = segments[0]?.toLowerCase();
  const basename = segments.at(-1)?.toLowerCase() ?? "";
  return (
    first === ".git" ||
    first === "secrets" ||
    first === "secret" ||
    first === "credentials" ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    value === ".shardcode/settings.local.json"
  );
}

function existingRealPath(value: string): string {
  let current = value;
  while (true) {
    try {
      return realpathSync.native(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(value);
      current = parent;
    }
  }
}

export function resolveWorkspacePath(workspaceRoot: string, requested: string): WorkspacePath {
  const root = resolve(workspaceRoot);
  const absolute = resolve(root, requested);
  const relativePath = relative(root, absolute).split(sep).join("/");
  const physicalRoot = existingRealPath(root);
  const physicalTarget = existingRealPath(absolute);
  const physicalRelative = relative(physicalRoot, physicalTarget);
  const lexicalWithinWorkspace = relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  const physicalWithinWorkspace = physicalRelative === "" || (!physicalRelative.startsWith("..") && !isAbsolute(physicalRelative));
  const withinWorkspace = lexicalWithinWorkspace && physicalWithinWorkspace;
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
