# Shard Interactive Slash Commands Design

**Date:** 2026-08-13  
**Status:** Approved by the user

## Goal

Turn the existing one-shot interactive terminal UI into a persistent CLI agent
session with local slash commands. Slash commands must be handled by the CLI,
never sent to the model as task text, while normal task execution continues to
use the existing runtime and permission boundaries.

## Scope

The interactive prompt accepts either a normal task or one of these local
commands:

| Command | Behavior |
| --- | --- |
| `/help` | Lists all slash commands and their usage. |
| `/help <command>` | Shows focused help for one command. |
| `/clear` | Clears the rendered TUI event history. |
| `/status` | Shows the last task/session status, or explains that none has run. |
| `/model` | Shows the configured provider and model; it does not change them. |
| `/permissions` | Shows the permission mode and whether isolated execution was requested. |
| `/resume <session-id>` | Resumes a persisted session through `AgentRuntime.resume`. |
| `/exit` | Leaves the TUI. |
| `/quit` | Alias for `/exit`. |

The TUI remains open after a task completes, fails, or is aborted. A user can
run another task, inspect the previous result, resume a session, or exit. An
empty input is rejected and re-prompts. A non-empty input that does not start
with `/` remains an ordinary task prompt.

Unknown slash commands and invalid argument counts are local errors. They are
rendered in the TUI and do not create a model request or a session.

## Architecture

### Slash command parser

Add a dependency-free `slash.ts` module containing:

- the canonical command definitions, usage text, and descriptions;
- a pure parser that returns either a normal task, a recognized command, or a
  local input error;
- case-insensitive command names;
- strict argument validation for every command.

Session IDs are accepted only as one safe token containing letters, digits,
hyphens, or underscores, with a maximum length of 128 characters. This keeps
the interactive command from turning user input into a path. The storage
adapter remains the final path-boundary enforcement layer.

### Persistent TUI loop

Extend the `TuiTerminal` abstraction with `clear()` and `setStatus()` so the
loop can update the screen without accessing the terminal implementation
directly. The default terminal keeps its current bounded event buffer and
redraws after status changes or a clear operation.

`runInteractiveTui` becomes a loop with this flow:

```text
open → wait for input → parse local command/task
  ├─ local command → render/perform command → wait again
  ├─ task/resume → execute through runtime → save summary → wait again
  └─ exit/quit → finish with the last task exit status → close
```

The TUI execution callback receives a discriminated request:

```ts
type InteractiveTaskRequest =
  | { kind: "run"; prompt: string }
  | { kind: "resume"; sessionId: string };
```

It returns an exit code plus a safe session snapshot used by `/status`. The
snapshot contains only session metadata and the original task prompt; it does
not expose tool outputs or secrets through the slash-command layer.

### CLI/runtime integration

`main.ts` keeps the existing `executeTask` construction path. It will return a
small internal execution result containing the numeric exit code and, when a
runtime call succeeds, the resulting `Session`. The non-interactive CLI still
returns only the numeric exit code. The TUI adapter maps `run` and `resume`
requests to the corresponding runtime commands and converts the session to the
bounded snapshot.

`/model` and `/permissions` read the parsed CLI configuration supplied when the
TUI starts. They are informational in this iteration; changing providers or
permission modes remains an explicit process-level CLI option.

## Error handling

- Empty input: render a short validation message and continue waiting.
- Unknown command or invalid arguments: render the parser error and continue.
- Missing or invalid resume session: render the runtime error and continue.
- Task failure: show the failure through the existing event renderer, mark the
  TUI status as failed/aborted, and continue waiting for another command.
- Terminal/input failure: close the TUI and return a non-zero exit code; an
  interrupt uses the existing `130` convention.

No command is retried by the TUI. Provider retries, tool observations,
permissions, budgets, and session persistence remain owned by their existing
packages.

## Security and boundaries

- Slash commands are parsed before any model call and are not included in
  model messages.
- `/resume` accepts only a safe session-id token; the runtime/storage path
  checks remain mandatory and unchanged.
- All task and resume execution continues through `ToolRuntime`, its
  permission engine, and the configured sandbox boundary.
- All command output continues through terminal sanitization before rendering.
- The CLI and TUI do not add direct filesystem, Git, or subprocess access.

## Testing

Add tests for:

1. Parsing every command, aliases, case normalization, normal tasks, unknown
   commands, invalid arguments, and unsafe session IDs.
2. The persistent TUI loop: local commands do not invoke execution, `/clear`
   calls the terminal clear operation, `/resume` dispatches the resume request,
   task results update status and `/status`, and `/exit` closes exactly once.
3. Main CLI integration: an interactive scripted task can complete and then
   exit through the slash command without creating a second runtime task.
4. Existing argument, renderer, runtime, tool-runtime, build, and lint tests
   continue to pass.

## Non-goals

This change does not add full-screen panels, scrollback navigation, live diff
views, model switching, parallel agents, autocomplete, or a real container/OS
sandbox. Those are separate features and must not be smuggled into the slash
command parser.
