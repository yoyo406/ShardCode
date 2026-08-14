# ShardCode

ShardCode is a CLI-first autonomous coding agent. It explores a repository,
calls an LLM through a normalized provider interface, edits files, runs
approved commands, observes failures, and iterates until validation succeeds.

## Quick start

```bash
pnpm install
pnpm build

# OpenAI is the default provider.
export OPENAI_API_KEY="..."
pnpm shardcode run "Implement the requested change and add tests"
```

During development, invoke the compiled binary directly:

```bash
node packages/cli/dist/index.js run "Inspect the repository"
```

### Interactive terminal mode

Invoke `shard` or `shardcode` with no arguments to open the interactive TUI:

```bash
pnpm shard
pnpm shardcode
```

The interactive mode requires both input and output to be a TTY and refuses
to run otherwise. Its welcome screen shows the ShardCode identity, workspace,
provider/model and a task suggestion. During a session, the event stream is
bounded and the footer reports only data available from ShardCode: status,
permission mode, provider/model, workspace and the last known session id.

Tasks can be entered directly at the prompt. The local slash commands are
`/help`, `/clear`, `/status`, `/model`, `/permissions`, `/resume <session-id>`,
`/connect`, `/exit` and `/quit` (`/quit` aliases `/exit`). `/connect` remains
parseable, but reports that connection is unavailable when this build has no
connection callback. Suggestions are examples only; they are never executed
automatically.

The TUI uses Option A: zero new TUI dependencies. It is implemented with
Node's existing `readline/promises` and hand-written ANSI sequences. The
semantic palette adapts to truecolor (`COLORTERM=truecolor` or `24bit`), ANSI
256 colors (`TERM=*256color`), ANSI 16 colors, and no color when the terminal
is not suitable. `COLORFGBG` can select the light palette; dark is the
fallback. Text remains readable without color.

Interactive presentation does not change runtime ownership: filesystem,
shell, Git, provider and session operations continue through the existing
CLI/runtime contracts. Terminal output from the model and tools is sanitized
before styling. Secret prompts mask entered characters, preserve pasted lines
after the secret for later input, and never add the secret to the event
history or debug output.

The TUI is intentionally not an OpenCode runtime clone. LSP, MCP,
sidebar/workspace-session views, interactive timeline/fork navigation,
sub-agent detail views, OpenTUI animations, RGBA compositing and native syntax
highlighting are excluded.

### Scriptable execution

Direct execution remains available for scripts and automation:

```bash
pnpm shard run "Implement the requested change"
pnpm shard resume <session-id>
pnpm shard run "Run the local smoke check" --provider scripted \
  --permission-mode acceptEdits --json
```

The bare task form (`pnpm shard "task description"`) is also a direct run.
`run` and `resume` retain their scriptable behavior. `--json` is a machine
readable JSONL path without ANSI styling; it is not available in interactive
mode.

The CLI defaults to permission mode `ask`. Read-only exploration is allowed;
workspace edits and shell commands are shown for approval. `acceptEdits` allows
workspace edits while still asking before shell execution:

```bash
pnpm shardcode run "Fix the failing tests" --permission-mode acceptEdits
```

`bypass` is accepted only with `--isolated-environment`. Use it only when the
process is already inside a container/OS sandbox with credentials and network
access scoped to the task.

## Providers

The provider adapters are normalized behind one tool-calling contract:

```bash
pnpm shardcode run "..." --provider openai --model gpt-4o-mini
pnpm shardcode run "..." --provider anthropic --model claude-3-5-sonnet-20241022
pnpm shardcode run "..." --provider gemini --model gemini-2.0-flash
```

Credentials are read from `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or
`GEMINI_API_KEY`. Provider transport failures use bounded retries; a failed
repository tool is returned to the model as an observation and is not retried
by the runtime.

For a no-network smoke run, use the deterministic provider:

```bash
pnpm shardcode run "Run the local smoke check" \
  --provider scripted --permission-mode acceptEdits
```

## Permissions and settings

Team rules can be committed in `.shardcode/settings.json`; personal overrides
belong in `.shardcode/settings.local.json`. Rules use `tool`, `path` and/or
`command` patterns and a `decision` of `allow`, `ask` or `deny`. Deny always
wins over ask, and ask wins over allow. `.git`, `.env`, secret paths and paths
outside the workspace are always denied.

See [.shardcode/settings.json.example](.shardcode/settings.json.example) for a
valid starting point.

## Budgets, sessions and output

Budgets are explicit and persisted with each session:

```bash
pnpm shardcode run "..." \
  --max-tokens 100000 \
  --max-tool-calls 100 \
  --max-wall-clock-seconds 1800
pnpm shardcode resume <session-id>
pnpm shardcode run "..." --json
```

Session state and JSONL events are stored under `.shardcode/sessions/`. A task
is completed only when the model emits `SHARDCODE_VALIDATED: ...` after at
least one successful validation command. Budget exhaustion and repeated
equivalent failures stop the session cleanly with resumable state.

## Development

```bash
pnpm build
pnpm test
pnpm lint
```

The monorepo boundaries and non-negotiable safety rules are documented in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). V1 deliberately uses agentic
`glob`/`grep`/`read_file` exploration; embeddings, vector search and full LSP
are out of scope.
