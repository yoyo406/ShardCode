# Shard Interactive Slash Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent interactive TUI loop with safe local slash commands, session inspection, and runtime-backed session resume.

**Architecture:** Keep slash parsing pure and dependency-free in a dedicated CLI module. Make `runInteractiveTui` own the persistent input/dispatch loop and expose only a bounded session snapshot to `/status`; adapt run/resume requests in `main.ts` to the existing `AgentRuntime` and `ToolRuntime` construction path.

**Tech Stack:** TypeScript strict, Node.js `readline/promises`, Vitest, pnpm workspaces, existing `@shardcode/runtime`, `@shardcode/shared`, and `@shardcode/tool-runtime` interfaces.

## Global Constraints

- No package under `packages/providers/*` is imported directly by `tool-runtime` or `context-engine`.
- Every file, shell, and Git operation remains behind `tool-runtime`; the CLI adds no direct execution path.
- Slash commands are local CLI input and are never sent to the model.
- `/resume` accepts only a safe single session-id token; storage path checks remain mandatory.
- Failed tool executions are observations and are not retried by the runtime.
- No embeddings, vector database, GUI, model switching, autocomplete, or real container/OS sandbox is added in this change.
- The implementation uses TDD: each production behavior gets a failing test before its implementation.

---

### Task 1: Add the pure slash-command parser

**Files:**
- Create: `packages/cli/src/slash.ts`
- Create: `packages/cli/src/slash.test.ts`

**Interfaces:**
- Produces `SlashCommandDefinition`, `SlashCommand`, `ParsedInteractiveInput`, `parseInteractiveInput(input: string)`, and `formatSlashHelp(command?: string)` for the TUI.
- `ParsedInteractiveInput` is one of:

```ts
type ParsedInteractiveInput =
  | { kind: "task"; prompt: string }
  | { kind: "command"; command: SlashCommand }
  | { kind: "invalid"; message: string };
```

- `SlashCommand` contains `help`, `clear`, `status`, `model`, `permissions`, `resume`, or `exit`; `quit` normalizes to `exit`.

- [ ] **Step 1: Write failing parser tests**

Add tests for:

```ts
expect(parseInteractiveInput("Implement OAuth")).toEqual({
  kind: "task",
  prompt: "Implement OAuth"
});
expect(parseInteractiveInput("/HELP model")).toEqual({
  kind: "command",
  command: { name: "help", target: "model" }
});
expect(parseInteractiveInput("/quit")).toEqual({
  kind: "command",
  command: { name: "exit" }
});
expect(parseInteractiveInput("/resume abc-123")).toEqual({
  kind: "command",
  command: { name: "resume", sessionId: "abc-123" }
});
expect(parseInteractiveInput("/resume ../secrets").kind).toBe("invalid");
expect(parseInteractiveInput("/clear extra").kind).toBe("invalid");
expect(parseInteractiveInput("/unknown").kind).toBe("invalid");
```

Run: `pnpm --filter @shardcode/cli exec vitest run src/slash.test.ts`

Expected: FAIL because `slash.ts` and its exported parser do not exist.

- [ ] **Step 2: Implement the minimal parser and help definitions**

Define the eight canonical commands and their usage/description in one
exported immutable definition list. Parse by trimming input, treating a
non-slash string as a task, lower-casing the command name, splitting arguments
on whitespace, enforcing exact argument counts, and validating resume IDs with
`/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/`.

`formatSlashHelp()` must render all commands; `formatSlashHelp("status")`
must render only the focused command and return a clear invalid-command error
for an unknown target.

- [ ] **Step 3: Run parser tests to verify GREEN**

Run: `pnpm --filter @shardcode/cli exec vitest run src/slash.test.ts`

Expected: all parser tests pass.

- [ ] **Step 4: Commit the parser**

```bash
git add packages/cli/src/slash.ts packages/cli/src/slash.test.ts
git commit -m "feat(cli): add interactive slash command parser"
```

### Task 2: Make the TUI persistent and dispatch local commands

**Files:**
- Modify: `packages/cli/src/tui.ts`
- Modify: `packages/cli/src/tui.test.ts`

**Interfaces:**
- Add `TuiStatus = "waiting" | "running" | "completed" | "failed" | "aborted"`.
- Add:

```ts
type InteractiveTaskRequest =
  | { kind: "run"; prompt: string }
  | { kind: "resume"; sessionId: string };

interface TuiSessionSnapshot {
  id: string;
  status: string;
  provider: string;
  model: string;
  prompt: string;
  updatedAt: string;
}

interface TuiExecutionResult {
  exitCode: number;
  session?: TuiSessionSnapshot;
}

interface InteractiveRuntimeInfo {
  provider: string;
  model: string;
  permissionMode: string;
  isolatedEnvironment: boolean;
}
```

- Extend `TuiTerminal` with `clear(): void` and `setStatus(status: TuiStatus): void`.
- Change `InteractiveTuiOptions.execute` to receive `InteractiveTaskRequest`
  and return `Promise<TuiExecutionResult>`; retain the existing
  `TuiExecutionIO` permission/output bridge.

- [ ] **Step 1: Write failing persistent-loop tests**

Extend the fake terminal with clear/status tracking and write tests that prove:

```ts
const requests: InteractiveTaskRequest[] = [];
const terminal = fakeTerminal(["/model", "Implement OAuth", "/status", "/clear", "/resume abc-123", "/exit"]);
const result = await runInteractiveTui({
  terminal,
  workspaceRoot: "/repo",
  info: { provider: "scripted", model: "scripted-local", permissionMode: "ask", isolatedEnvironment: false },
  execute: async (request) => {
    requests.push(request);
    return {
      exitCode: 0,
      session: { id: "abc-123", status: "completed", provider: "scripted", model: "scripted-local", prompt: "Implement OAuth", updatedAt: "2026-08-13T00:00:00.000Z" }
    };
  }
});

expect(result).toBe(0);
expect(requests).toEqual([
  { kind: "run", prompt: "Implement OAuth" },
  { kind: "resume", sessionId: "abc-123" }
]);
expect(terminal.clearCount).toBe(1);
expect(terminal.statuses).toContain("running");
expect(terminal.lines.join("\n")).toContain("scripted-local");
```

Also test that unknown/invalid slash input does not call `execute`, `/status`
reports no session before the first task, `/exit` closes once, and a non-TTY
still fails closed.

Run: `pnpm --filter @shardcode/cli exec vitest run src/tui.test.ts`

Expected: FAIL because the current TUI exits after one task and has no command
parser integration or new terminal methods.

- [ ] **Step 2: Implement the persistent loop**

Open the terminal once, then repeatedly ask `Task or /command: `. Parse each
input with `parseInteractiveInput`:

- `help`: write `formatSlashHelp(target)` and continue;
- `clear`: call `terminal.clear()` and continue;
- `model`: render provider/model from `info` and continue;
- `permissions`: render mode and isolated-environment state and continue;
- `status`: render the last snapshot or a no-session message and continue;
- `exit`: return the last task exit code;
- `task`/`resume`: set status to `running`, call `execute`, retain its snapshot,
  set status from its exit code, and continue;
- `invalid`: render the error and continue.

Catch an execution callback error per task, render it, mark the task failed,
and continue the interactive session. Keep the outer `finally` responsible for
one `finish(exitCode)` and one `close()` call. Preserve the existing `130`
interrupt convention.

Update `createDefaultTuiTerminal()` so `clear()` empties the bounded line
buffer, `setStatus()` updates the redraw header, and `finish()` maps the final
exit code to the terminal status.

- [ ] **Step 3: Run TUI tests to verify GREEN**

Run: `pnpm --filter @shardcode/cli exec vitest run src/tui.test.ts`

Expected: all persistent-loop tests pass.

- [ ] **Step 4: Commit the persistent TUI**

```bash
git add packages/cli/src/tui.ts packages/cli/src/tui.test.ts
git commit -m "feat(cli): add persistent slash command tui"
```

### Task 3: Connect run/resume results to the TUI

**Files:**
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/src/main.test.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Add an internal `TaskExecutionResult` with `exitCode: number` and optional
  `session: Session`.
- Keep `runCli(argv, io): Promise<number>` unchanged for all callers.

- [ ] **Step 1: Write failing CLI integration tests**

Update the fake TUI to answer `Run the checks`, `/status`, and `/exit`, then
assert that the scripted runtime is executed once, the status output contains
the completed session, and the terminal closes once. Add a resume dispatch test
with a fake `TuiTerminal` only if needed to distinguish the request shape from
the parser tests.

Run: `pnpm --filter @shardcode/cli exec vitest run src/main.test.ts`

Expected: FAIL because `main.ts` currently expects a one-shot prompt and the
TUI execution callback has no request/result adapter.

- [ ] **Step 2: Adapt `executeTask` without changing runtime boundaries**

Return `{ exitCode, session }` from the existing try path and `{ exitCode: 1 }`
from the catch path. Keep `ToolRuntime.create`, `JsonSessionStore`, provider
construction, `AgentRuntime.run`, and `AgentRuntime.resume` exactly on the
existing path. Make non-interactive `runCli` return `result.exitCode`.

For interactive mode, pass provider/model/permission configuration as
`InteractiveRuntimeInfo`, map `{ kind: "run" }` to `command: "run"`, map
`{ kind: "resume" }` to `command: "resume"`, and convert the returned `Session`
to the six-field `TuiSessionSnapshot`.

- [ ] **Step 3: Export the slash/TUI public helpers from the CLI entrypoint**

Export `slash.ts` and `tui.ts` from `packages/cli/src/index.ts` so tests and
future CLI integrations can use the typed command interfaces without importing
private implementation paths.

- [ ] **Step 4: Run CLI integration tests to verify GREEN**

Run: `pnpm --filter @shardcode/cli exec vitest run src/main.test.ts src/tui.test.ts src/slash.test.ts`

Expected: all CLI slash-command tests pass.

- [ ] **Step 5: Commit the runtime adapter**

```bash
git add packages/cli/src/main.ts packages/cli/src/main.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): connect slash tui to task sessions"
```

### Task 4: Document and verify the complete feature

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Document the interactive command set**

Add the slash command table and an example session to the README. Update the
architecture document's public command section to mention `shard`/`shardcode`
interactive mode and its local slash-command loop while preserving the
package-boundary rules.

- [ ] **Step 2: Run the complete verification suite**

Run each command from the repository root:

```bash
pnpm test
pnpm build
pnpm lint
git diff --check
```

Expected: every command exits with code 0 and Vitest reports zero failures.

- [ ] **Step 3: Run a no-network interactive smoke test**

Feed a scripted task followed by `/status` and `/exit` through a TTY wrapper:

```bash
printf 'Run the checks\n/status\n/exit\n' | script -q -c 'node packages/cli/dist/index.js --provider scripted --permission-mode bypass --isolated-environment' /tmp/shardcode-slash-smoke.typescript
```

Expected: the output contains the task completion, the last session status,
and a final completed TUI status without a network request.

- [ ] **Step 4: Commit documentation and verification-ready changes**

```bash
git add README.md docs/ARCHITECTURE.md
git commit -m "docs(cli): document interactive slash commands"
```
