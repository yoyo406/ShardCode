# ShardCode Real CLI Design

## Goal

Turn the empty repository into a usable CLI that can accept a coding task,
inspect the current repository, make changes, run checks, and iterate through
an LLM tool-calling loop while preserving permission and session boundaries.

## User-facing flow

```bash
shardcode run "Implement OAuth login and add tests" \
  --provider openai \
  --permission-mode ask
shardcode resume <session-id>
```

The CLI prints model messages, tool requests, permission prompts, tool output,
and the final session status. It exits non-zero for denied/aborted/failed
tasks. `--json` emits the event stream as JSON lines for scripting.

## Architecture

The monorepo contains `shared`, `providers`, `tool-runtime`,
`context-engine`, `memory`, `sandbox`, `runtime` and `cli`. `runtime` is the
only orchestrator. Filesystem, shell and Git implementations are private to
`tool-runtime`; the CLI and runtime receive interfaces only.

The normalized provider contract accepts messages and tool schemas and returns
text, normalized tool calls, usage and finish information. OpenAI Chat
Completions, Anthropic Messages and Gemini `generateContent` adapters translate
to that contract. A scripted provider remains available for deterministic
runtime tests.

## Execution and safety

The tool runtime exposes the V1 tools from the canvas. Every invocation is
checked by a three-level permission engine before execution. Read/search/Git
inspection is allowed by default. In `ask` mode writes and shell need approval;
`acceptEdits` permits workspace writes; `bypass` requires an explicit isolated
environment flag. Protected paths always deny. Arbitrary approved shell
commands are delegated to a sandbox boundary and fail closed if no process
sandbox is configured.

Project and local JSON settings are loaded by the permission engine. Rules are
matched against tool, path and command, with deny taking precedence over ask,
and ask over allow. The engine records the decision reason in the tool result
and event stream.

## Runtime state

The runtime persists a serializable session under `.shardcode/sessions/` and a
JSONL event log. It enforces token, tool-call and wall-clock budgets. It does
not retry tool execution failures. Provider transport failures use bounded
backoff. A normalized failure signature repeated three times emits
`ThrashingDetected` and aborts.

The system prompt requires the agent to explore with the search tools, use
tools for all repository actions, run the relevant test/build/lint commands,
and finish with `SHARDCODE_VALIDATED: ...` only after the request is satisfied.
The runtime requires that marker plus successful validation commands before
reporting `Completed`.

## Testing strategy

Each package has focused unit tests for its public boundaries. Provider tests
exercise request translation and response normalization with a supplied fetch
implementation. Tool tests cover path protection, permission decisions and
the no-retry failure contract. Runtime tests use the scripted provider and an
in-memory tool invoker/storage. An end-to-end CLI smoke test verifies argument
parsing and session lifecycle without making a network request.

## Non-goals

This slice does not implement GUI, embeddings, a vector index, LSP, cloud
infrastructure, automatic pushes, or unbounded shell/network access.
