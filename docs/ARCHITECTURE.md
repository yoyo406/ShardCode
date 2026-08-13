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

The public commands are:

```text
shard                                  # interactive TUI
shardcode                              # interactive TUI alias
shard "task description"               # direct task shorthand
shardcode run "task description"
shardcode resume <session-id>
```

Interactive mode keeps one terminal session open after each task. `/help`,
`/clear`, `/status`, `/model`, `/permissions`, `/resume <session-id>`,
`/connect`, `/exit`, and `/quit` are local CLI commands; they are parsed before
a model request and are never included in model messages. Task and resume requests
continue through the same runtime, permission engine, session store, and
sandbox path as the explicit commands.

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
through the `SandboxRunner` boundary and fails closed when no sandbox is
configured. The default process runner is not marked isolated; the
`--isolated-environment` flag only asserts that the caller has already provided
OS/container isolation.

## Context and memory

V1 uses agentic repository search only: `glob`, `grep`, `read_file` and
`list_files`, with Git history tools available to the model. There is no
embedding index, vector database or LSP dependency. The context engine accepts
a tool invoker rather than importing providers or touching the filesystem.

Session memory is the serialized session and event log. Project guidance is
`SHARDCODE.md`, supplemented by the scoped JSON memory store; user memory is
an explicit, separately scoped store. Every memory entry carries source,
timestamp and scope.

## Completion, budgets and errors

The task is complete only when the model emits an explicit validation marker
and at least one recognized project validation command has passed. Tool
failures, denied permissions and validation failures are observations, not
implicit retries. Token, tool-call and cumulative wall-clock budgets are
persisted and enforced by the runtime. Repeated
equivalent failing observations trigger a `ThrashingDetected` event and abort
the task cleanly.

Provider adapters normalize tool calls, streaming-independent responses,
usage and typed provider errors behind `ModelProvider`. The provider registry
supports OpenAI, OpenAI-Codex, Google Gemini, Mistral, Anthropic Claude,
OpenCode Zen/Go, Cline and Kilo through native, Responses, Anthropic Messages
and OpenAI-compatible HTTP adapters without coupling the runtime to any SDK.
Interactive connections are user-scoped and stored outside the workspace with
owner-only file permissions; the CLI injects the selected connection into the
runtime at task start.

## Deliberate V1 exclusions

No GUI, cloud execution, multi-user collaboration, embeddings/RAG, full LSP,
distributed agents, automatic Git push, or unrestricted network access is part
of this first implementation.
