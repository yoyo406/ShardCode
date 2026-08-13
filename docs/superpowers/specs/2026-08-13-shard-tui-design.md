# Shard TUI and launcher design

## Goal

Add a short interactive entry point for ShardCode without changing the
runtime's execution boundaries. The existing `shardcode run` and
`shardcode resume` commands remain available for scripts and automation.

## User-facing commands

- `shard` with no arguments opens the interactive terminal UI.
- `shard "task description"` starts a task directly and is equivalent to
  `shardcode run "task description"`.
- `shardcode` with no arguments also opens the same TUI, so the compiled
  executable behaves consistently when invoked through either binary name.
- `shardcode run ...`, `shardcode resume ...` and `--help` keep their current
  semantics.
- Both package bin names, `shard` and `shardcode`, point at the same CLI
  entrypoint. The root package exposes matching `pnpm shard` and
  `pnpm shardcode` development scripts.

## TUI behavior

The V1 TUI is intentionally dependency-free and uses Node's standard
terminal APIs plus ANSI control sequences:

1. Render a compact header with the ShardCode name and current workspace.
2. Prompt for one task description. An empty task is rejected and the prompt
   remains available.
3. Clear the prompt view and render a live activity panel while the existing
   `runCli` lifecycle executes. Runtime events are rendered through the same
   event renderer used by the non-JSON CLI.
4. Permission requests remain interactive and use the existing allow/deny
   question flow. A non-TTY invocation fails closed rather than pretending to
   approve an action.
5. Render the final session status and a short next-step hint. Ctrl+C keeps
   the existing process interruption behavior; no data is deleted.

The TUI owns terminal presentation only. It does not import provider packages
directly, execute subprocesses, or read/write repository files.

## Boundaries and implementation shape

- `args.ts` owns the `interactive` command and the bare-prompt shorthand.
- `tui.ts` owns terminal detection, task input, screen rendering, and TUI
  output adapters.
- `main.ts` dispatches to the TUI and continues to construct
  `ToolRuntime`, `ContextEngine`, `MemoryStore`, and `AgentRuntime` exactly as
  it does for the existing commands.
- `index.ts` remains a thin process entrypoint.
- The package manifest exposes both executable names; no new runtime package
  or provider dependency is introduced.

## Testing and acceptance criteria

- Argument tests cover empty interactive invocation, bare task shorthand, and
  preservation of explicit `run`/`resume` parsing.
- TUI tests use injected input/output adapters and verify that a task is
  collected, events are forwarded, and an empty task is requested again.
- Existing lifecycle tests remain green.
- `pnpm build`, `pnpm test`, and `pnpm lint` pass.
- A no-network smoke command through the new launcher completes with the
  scripted provider.

## Deliberate V1 limits

This is a lightweight terminal UI, not a full-screen component framework. It
does not add mouse support, panes, scrollback management, task history, or
parallel-agent visualization. Those can be added later without changing the
runtime boundary because the TUI consumes the existing event stream.
