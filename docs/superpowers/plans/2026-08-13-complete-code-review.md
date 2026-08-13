# Complete Code Review and Bug-Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the full ShardCode monorepo, fix confirmed correctness and security defects, verify the complete project, and publish the fixes in a new pull request.

**Architecture:** Preserve the existing package boundaries. Correct provider response normalization in `packages/providers`, validate permission configuration at its parsing boundary in `packages/tool-runtime`, tighten CLI argument validation in `packages/cli`, and add regression tests beside each affected module. No unrelated refactor is in scope.

**Tech Stack:** TypeScript 5, Node.js ESM, pnpm workspaces, Vitest, GitHub CLI.

## Global Constraints

- Keep API keys out of workspace files, terminal rendering, logs, and test output.
- Preserve the existing provider catalog and `/connect` behavior.
- Fix root causes with regression tests before changing production code.
- Keep the existing `origin/main` base and publish a new PR because PR #4 is already merged.

---

### Task 1: Harden permission-rule parsing

**Files:**
- Modify: `packages/tool-runtime/src/permissions.ts`
- Test: `packages/tool-runtime/src/permissions.test.ts`

**Interfaces:**
- `PermissionEngine.create()` continues to return an engine with only valid `allow`, `ask`, or `deny` rules.
- Malformed rules are ignored or rejected safely; they must never produce an invalid decision that bypasses the normal permission policy.

- [x] **Step 1: Add a regression test** proving that a malformed rule decision does not permit a write in `ask` mode.
- [x] **Step 2: Run the focused test and confirm it fails because the malformed rule is currently accepted.**
- [x] **Step 3: Validate loaded rule shapes at the parsing boundary and discard malformed rules.**
- [x] **Step 4: Run the focused permission tests and confirm they pass.**

### Task 2: Normalize provider completion statuses

**Files:**
- Modify: `packages/providers/src/provider.ts`, `packages/providers/src/responses.ts`, `packages/providers/src/anthropic.ts`
- Test: `packages/providers/src/runtime.test.ts`

**Interfaces:**
- `ModelResponse.finishReason` remains one of the shared normalized values.
- Responses API `completed` maps to `stop`; Anthropic `end_turn` maps to `stop` and `max_tokens` maps to `length`.

- [x] **Step 1: Add focused provider tests for the documented terminal statuses.**
- [x] **Step 2: Run the focused tests and confirm the new assertions fail.**
- [x] **Step 3: Extend the shared finish-reason normalization mapping.**
- [x] **Step 4: Run provider runtime tests and confirm they pass.**

### Task 3: Reject extra resume positionals

**Files:**
- Modify: `packages/cli/src/args.ts`
- Test: `packages/cli/src/args.test.ts`

**Interfaces:**
- `resume` accepts exactly one session ID; extra positional arguments produce a usage error.
- Existing direct task and run command parsing remains unchanged.

- [x] **Step 1: Add a failing parser test for `resume session-id extra`.**
- [x] **Step 2: Run the focused parser test and confirm it fails.**
- [x] **Step 3: Enforce exactly one resume positional.**
- [x] **Step 4: Run parser tests and confirm they pass.**

### Task 4: Review and harden provider config file permissions

**Files:**
- Modify: `packages/cli/src/provider-store.ts`
- Test: `packages/cli/src/provider-store.test.ts`

**Interfaces:**
- Loading an existing connections file repairs its owner-only mode before returning credentials.
- Symlink protections and atomic writes remain intact.

- [x] **Step 1: Add a regression test for an existing config file with permissive mode.**
- [x] **Step 2: Run the focused store test and confirm it fails.**
- [x] **Step 3: Apply owner-only permissions to the existing file after a successful read.**
- [x] **Step 4: Run provider-store tests and confirm they pass.**

### Task 5: Full verification and integration

**Files:**
- Review: all tracked files under `packages/`, `docs/`, root configuration, and lockfile.

- [x] **Step 1: Run `pnpm test`.**
- [x] **Step 2: Run `pnpm lint`, `pnpm build`, `pnpm audit --audit-level high`, `git diff --check`, and conflict-marker checks.**
- [x] **Step 3: Run a compiled `/connect` smoke test without exposing the test key.**
- [ ] **Step 4: Request a read-only code review over the final commit range and fix any Critical/Important findings.**
- [ ] **Step 5: Commit the fixes, push the branch, and create a new PR against `main`.**

### Task 6: Force non-streaming provider responses

**Files:**
- Modify: `packages/providers/src/openai-compatible.ts`, `packages/cli/src/tui.ts`
- Test: `packages/providers/src/runtime.test.ts`, `packages/cli/src/tui.test.ts`

**Interfaces:**
- OpenAI-compatible adapters continue to return a parsed `ModelResponse` from one JSON response.
- Requests explicitly send `stream: false` so providers whose default is streaming remain compatible.

- [x] **Step 1: Add a regression test asserting the request body disables streaming.**
- [x] **Step 2: Run the focused provider test and confirm it fails.**
- [x] **Step 3: Add the explicit `stream: false` request field.**
- [x] **Step 4: Preserve additional pasted lines after masked secret input and cover the behavior with a focused test.**
- [x] **Step 5: Run provider runtime and TUI tests and confirm they pass.**
