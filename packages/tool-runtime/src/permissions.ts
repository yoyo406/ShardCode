import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  PermissionDecision,
  PermissionLevel,
  PermissionMode,
  PermissionRequest,
  PermissionRule,
  PermissionSettings
} from "@shardcode/shared";
import { normalizeRulePath, resolveWorkspacePath } from "./paths.js";

export interface PermissionEngineOptions {
  workspaceRoot: string;
  mode: PermissionMode;
  isolatedEnvironment?: boolean;
  settings?: PermissionSettings;
  localSettings?: PermissionSettings;
}

const RANK: Record<PermissionLevel, number> = { allow: 1, ask: 2, deny: 3 };

function matches(value: string | undefined, pattern: string | undefined): boolean {
  if (pattern === undefined) return true;
  if (value === undefined) return false;
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function isPermissionRule(value: unknown): value is PermissionRule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rule = value as Record<string, unknown>;
  return (
    (rule.tool === undefined || typeof rule.tool === "string") &&
    (rule.path === undefined || typeof rule.path === "string") &&
    (rule.command === undefined || typeof rule.command === "string") &&
    (rule.decision === "allow" || rule.decision === "ask" || rule.decision === "deny") &&
    (rule.reason === undefined || typeof rule.reason === "string")
  );
}

function matchingRule(request: PermissionRequest, rule: PermissionRule): boolean {
  const path = request.path ? normalizeRulePath(request.path) : undefined;
  return (
    matches(request.toolName, rule.tool) &&
    matches(path, rule.path ? normalizeRulePath(rule.path) : undefined) &&
    matches(request.command, rule.command)
  );
}

function parseRule(value: unknown): PermissionRule | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.decision !== "allow" && record.decision !== "ask" && record.decision !== "deny") return undefined;
  for (const key of ["tool", "path", "command", "reason"]) {
    if (record[key] !== undefined && typeof record[key] !== "string") return undefined;
  }
  const rule: PermissionRule = { decision: record.decision };
  if (typeof record.tool === "string") rule.tool = record.tool;
  if (typeof record.path === "string") rule.path = record.path;
  if (typeof record.command === "string") rule.command = record.command;
  if (typeof record.reason === "string") rule.reason = record.reason;
  return rule;
}

async function loadSettings(path: string): Promise<PermissionSettings> {
  try {
    const content = await readFile(path, "utf8");
    const value: unknown = JSON.parse(content);
    if (typeof value !== "object" || value === null) return {};
    const rules = (value as { rules?: unknown }).rules;
<<<<<<< HEAD
    return Array.isArray(rules) ? { rules: rules.filter(isPermissionRule) } : {};
=======
    if (!Array.isArray(rules)) return {};
    return { rules: rules.flatMap((rule) => {
      const parsed = parseRule(rule);
      return parsed ? [parsed] : [];
    }) };
>>>>>>> origin/main
  } catch {
    return {};
  }
}

export class PermissionEngine {
  readonly workspaceRoot: string;
  private readonly options: PermissionEngineOptions;
  private readonly projectRules: PermissionRule[];
  private readonly localRules: PermissionRule[];

  constructor(options: PermissionEngineOptions) {
    this.options = options;
    this.workspaceRoot = options.workspaceRoot;
    this.projectRules = options.settings?.rules?.flatMap((rule) => {
      const parsed = parseRule(rule);
      return parsed ? [parsed] : [];
    }) ?? [];
    this.localRules = options.localSettings?.rules?.flatMap((rule) => {
      const parsed = parseRule(rule);
      return parsed ? [parsed] : [];
    }) ?? [];
  }

  static async create(options: PermissionEngineOptions): Promise<PermissionEngine> {
    const [settings, localSettings] = await Promise.all([
      options.settings ? Promise.resolve(options.settings) : loadSettings(join(options.workspaceRoot, ".shardcode/settings.json")),
      options.localSettings
        ? Promise.resolve(options.localSettings)
        : loadSettings(join(options.workspaceRoot, ".shardcode/settings.local.json"))
    ]);
    return new PermissionEngine({ ...options, settings, localSettings });
  }

  check(request: PermissionRequest): PermissionDecision {
    if (request.path) {
      const resolved = resolveWorkspacePath(this.workspaceRoot, request.path);
      if (!resolved.withinWorkspace) {
        return { level: "deny", reason: "path is outside the allocated workspace" };
      }
      if (resolved.protected) {
        return { level: "deny", reason: "path is protected by the workspace security policy" };
      }
    }

    if (this.options.mode === "bypass" && !this.options.isolatedEnvironment) {
      return { level: "deny", reason: "bypass mode requires an explicitly isolated environment" };
    }

    const rules = [...this.projectRules, ...this.localRules]
      .filter((rule) => matchingRule(request, rule))
      .sort((left, right) => RANK[right.decision] - RANK[left.decision]);
    const rule = rules[0];
    if (rule) {
      return {
        level: rule.decision,
        reason: rule.reason ?? `matched ${rule.decision} permission rule`,
        matchedRule: rule
      };
    }

    if (request.toolName === "git_diff" && request.path === undefined) {
      return { level: "ask", reason: "an unscoped Git diff may disclose protected files" };
    }

    if (this.options.mode === "bypass") {
      return { level: "allow", reason: "bypass mode is enabled inside an isolated environment" };
    }
    if (request.risk === "read" || request.risk === "git") {
      return { level: "allow", reason: "read-only repository operation" };
    }
    if (request.risk === "write" && this.options.mode === "acceptEdits") {
      return { level: "allow", reason: "workspace edit allowed by acceptEdits mode" };
    }
    return { level: "ask", reason: `${request.risk} operation requires approval` };
  }
}
