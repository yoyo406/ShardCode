# Fix CLI Boundaries and Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the CLI, tool runtime, sandbox, validation gate, budgets, memory behavior and documentation with the documented repository boundaries.

**Architecture:** Keep `runtime` as the orchestrator and `tool-runtime` as the only filesystem/shell boundary. Pass the actual repository root into the CLI instead of relying on the package process directory, make sandbox isolation explicit, and preserve persisted budget state across resume.

**Tech Stack:** Node.js 24+, TypeScript strict, pnpm workspaces, native fetch, Vitest.

## Global Constraints

- No filesystem, shell or Git execution occurs directly in `runtime` or `cli`.
- `.git`, `.env`, secret directories and paths outside the workspace remain denied.
- Failed tool executions remain observations and are not retried.
- `pnpm build`, `pnpm test` and `pnpm lint` must pass from the repository root.
- Every production behavior change gets a failing regression test first.

---

### Task 1: Fix CLI workspace-root propagation

**Files:**
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/src/main.test.ts`
- Modify: `.gitignore`
- Modify: `README.md`

- [x] Write a failing test proving `runCli` uses an explicitly supplied repository root rather than the package process directory, and that the scripted smoke path persists under that root.
- [x] Run the focused CLI test and confirm it fails because `process.cwd()` is currently used.
- [x] Implement a root-resolution helper that prefers `SHARDCODE_WORKSPACE_ROOT`, then pnpm's `INIT_CWD`, then `process.cwd()`, while preserving injected `CliIO.cwd` for tests.
- [x] Add a recursive `.shardcode` ignore rule for nested invocations and document the supported root behavior.
- [x] Run the focused CLI tests and confirm they pass.

### Task 2: Make shell isolation explicit and fail closed

**Files:**
- Modify: `packages/tool-runtime/src/runtime.ts`
- Modify: `packages/sandbox/src/sandbox.ts`
- Modify: `packages/tool-runtime/src/tools.test.ts`
- Modify: `packages/sandbox/src/sandbox.test.ts`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`

- [x] Write failing tests proving a default tool runtime does not claim isolation and refuses shell execution without an injected sandbox, while an explicitly injected isolated runner still executes.
- [x] Run the focused tests and confirm the current default `isolated: true` behavior fails the new expectations.
- [x] Implement `isolatedEnvironment` with a safe `false` default and require an injected or explicitly configured sandbox before shell execution; do not relabel local `spawn` as isolated.
- [x] Run sandbox and tool-runtime tests and confirm they pass.

### Task 3: Correct glob semantics and path containment

**Files:**
- Modify: `packages/tool-runtime/src/tools.ts`
- Modify: `packages/tool-runtime/src/paths.ts`
- Modify: `packages/tool-runtime/src/tools.test.ts`

- [x] Write failing tests for `src/**/*.ts` matching both `src/index.ts` and `src/lib/index.ts`, and for a symlink whose real target escapes the workspace being denied.
- [x] Run the focused tool-runtime tests and confirm the current glob and lexical-only path checks fail.
- [x] Implement `**/` zero-or-more-directory matching and realpath-aware workspace checks for file operations.
- [x] Run the focused tool-runtime tests and confirm they pass.

### Task 4: Strengthen validation and resume budgets

**Files:**
- Modify: `packages/runtime/src/agent-runtime.ts`
- Modify: `packages/runtime/src/budget.ts`
- Modify: `packages/runtime/src/agent-runtime.test.ts`
- Modify: `packages/runtime/src/budget.test.ts`

- [x] Write failing tests proving an unrelated successful shell command cannot satisfy validation and that resumed wall-clock accounting includes elapsed time from the original session.
- [x] Run the focused runtime tests and confirm the current validation and timer behavior fails.
- [x] Implement explicit validation-command tracking with failed-command recording, and persist/restore the budget start timestamp without resetting it on resume.
- [x] Run the focused runtime tests and confirm they pass.

### Task 5: Align project memory and documentation

**Files:**
- Modify: `packages/memory/src/memory.ts`
- Modify: `packages/memory/src/memory.test.ts`
- Modify: `packages/runtime/src/agent-runtime.ts`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/superpowers/plans/2026-08-13-real-cli.md`

- [x] Write a failing memory test for loading project guidance from `SHARDCODE.md` while retaining scoped JSON memory.
- [x] Run the focused memory test and confirm the file is currently ignored.
- [x] Implement the documented project-memory read path through the existing storage boundary and update stale checklist/documentation text.
- [x] Run the focused memory and runtime tests and confirm they pass.

### Task 6: Full verification, commit, push and PR

- [x] Run `pnpm build`, `pnpm test`, `pnpm lint`, `git diff --check`, and a direct CLI smoke test from the repository root.
- [x] Review the complete diff and verify no generated session/build files are tracked.
- [x] Commit the implementation with a focused message.
- [x] Push `verify-project-structure` to `origin`.
- [x] Create a pull request if the GitHub CLI or connected GitHub capability is available; otherwise report the exact push result and the PR blocker.
