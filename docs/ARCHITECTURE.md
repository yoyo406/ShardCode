# ShardCode Architecture

This document records the V1 implementation boundaries for the CLI described
in the Project Canvas v2. The model decides what to do; the runtime controls
whether and how it is executed.

## Package boundaries

```text
cli -> runtime -> { context-engine, tool-runtime, memory, sandbox, providers }
                         \-> shared
context-engine -> shared
tool-runtime -> shared
memory -> shared
sandbox -> shared
providers -> shared
```

`runtime` is the only package that orchestrates the agent, context engine and
tool runtime. Packages under `packages/providers/*` are never imported by
`tool-runtime` or `context-engine`. CLI code never performs filesystem,
subprocess or Git operations directly.

## V1 execution model

The public CLI modes are:

```text
shardcode                         # interactive TTY mode
shardcode "task description"      # direct run
shardcode run "task description"
shardcode resume <session-id>
shardcode run "..." --json        # scriptable JSONL events
```

With no arguments, the CLI selects the interactive terminal UI only when its
input and output are TTYs; it fails closed for non-TTY use. The UI is a
presentation/input layer in `packages/cli`, not a second runtime: it does not
perform filesystem, subprocess, Git, provider, or session operations itself.
Those actions continue through the existing CLI-to-runtime contracts. Direct
`run`/`resume` execution and `--json` remain machine-oriented paths, and JSON
events are emitted without ANSI styling.

The runtime maintains the state hierarchy `Session -> Task -> Subtask ->
Attempt -> ToolExecution`, persists the session under `.shardcode/sessions/`,
and appends a JSONL event stream for each session. The loop is dynamic:

```text
observe -> reason -> choose tool -> permission check -> execute -> observe
```

An individual tool failure is returned to the model as an observation. The
runtime does not retry failed tool executions. Provider transport errors may be
retried with bounded exponential backoff.

## Tool runtime and permissions

All file, shell and Git actions go through `tool-runtime`. It owns path
canonicalization, workspace boundaries, command execution and the permission
engine. Permission decisions are `allow`, `ask` or `deny`; protected paths
(`.git`, `.env`, secret directories and paths outside the workspace) are
always denied. Project rules live in `.shardcode/settings.json`; local rules
live in `.shardcode/settings.local.json`.

The CLI's default mode is `ask`. `acceptEdits` allows workspace edits while
still asking for shell actions. `bypass` is rejected unless the caller
explicitly marks the process as running inside an isolated environment.

Worktrees isolate filesystem state between future parallel subtasks. They do
not count as execution sandboxes. Arbitrary shell execution therefore passes
through the `SandboxRunner` boundary and must fail closed when a configured
process sandbox is unavailable.

## Context and memory

V1 uses agentic repository search only: `glob`, `grep`, `read_file` and
`list_files`, with Git history tools available to the model. There is no
embedding index, vector database or LSP dependency. The context engine accepts
a tool invoker rather than importing providers or touching the filesystem.

The interactive UI uses only Node `readline/promises` and local ANSI helpers
(Option A, zero new TUI dependencies). Its color output falls back from
truecolor to ANSI 256, ANSI 16, and no color as terminal capabilities require.
It exposes only ShardCode metadata in its welcome/session/footer views. LSP,
MCP, sidebar/workspace-session views, timeline/fork/sub-agent detail,
OpenTUI animations/RGBA rendering, and native syntax highlighting are outside
the CLI architecture and are not simulated by the TUI.

Session memory is the serialized session and event log. Project memory is
`SHARDCODE.md` and user memory is an explicit, separately scoped store. Every
memory entry carries source, timestamp and scope.

## Completion, budgets and errors

The task is complete only when the model emits an explicit validation marker
and the relevant project checks it ran have passed. Tool failures, denied
permissions and validation failures are observations, not implicit retries.
Token, tool-call and wall-clock budgets are enforced by the runtime. Repeated
equivalent failing observations trigger a `ThrashingDetected` event and abort
the task cleanly.

Provider adapters normalize tool calls, streaming-independent responses,
usage and typed provider errors behind `ModelProvider`. V1 ships HTTP adapters
for OpenAI, Anthropic and Gemini without coupling the runtime to any one SDK.

## Deliberate V1 exclusions

No GUI, cloud execution, multi-user collaboration, embeddings/RAG, full LSP,
distributed agents, automatic Git push, or unrestricted network access is part
of this first implementation.
