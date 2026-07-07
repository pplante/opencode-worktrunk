# opencode-worktrunk

An opencode plugin that lets agents manage git worktrees through the [worktrunk](https://worktrunk.dev) CLI (`wt`). When an agent creates or switches to a worktree, the opencode session's working directory is rebound to that worktree automatically.

## What it does

Provides five tools to opencode agents:

- **worktrunk_create** — Create a new worktree on a new branch. Session moves there.
- **worktrunk_switch** — Switch to an existing branch's worktree. Session moves there.
- **worktrunk_merge** — Merge the current branch into the target (default branch by default). Removes the worktree, session moves to the target.
- **worktrunk_list** — List all worktrees. Marks the active one.
- **worktrunk_remove** — Remove a worktree. Refuses if it's the active one.
- **worktrunk sidebar** — A sidebar panel that lists every worktree in the repo and highlights the active one. Auto-refreshes on session switches and every 10s. Read-only; switching/removing still goes through the tools above.

After a create, switch, or merge, every tool (read, edit, bash, glob, grep, lsp) operates from the worktree root. No permission prompts for in-worktree file edits.

## Requirements

- [opencode](https://opencode.ai) 1.17+
- [worktrunk](https://worktrunk.dev) (`wt`) v0.65.0+, installed and on PATH
- [Bun](https://bun.sh) for running tests

## Install

```bash
git clone <repo> ~/Projects/opencode-wt
cd ~/Projects/opencode-wt
bun install
ln -sf "$(pwd)/src/worktrunk-wt.ts"      ~/.config/opencode/plugins/worktrunk-wt.ts
ln -sf "$(pwd)/src/worktrunk-sidebar.tsx"  ~/.config/opencode/plugins/worktrunk-sidebar.tsx
```

Restart opencode.

## Test

```bash
bun test
```

## Architecture

Pure helpers are extracted into testable modules. The plugin entry is thin glue.

| File | Responsibility |
|---|---|
| `src/paths.ts` | `isUnderPath`, `resolvePath` — path comparison and symlink resolution |
| `src/parse.ts` | Parsers for `wt --format json` output (switch, list, merge, remove) |
| `src/args.ts` | CLI argument builders for each `wt` subcommand |
| `src/state.ts` | Per-session state map (active worktree path + branch) |
| `src/sidebar.ts` | Pure helper: `formatSidebarRows` — turns `ListEntry[]` into renderable rows |
| `src/worktrunk-wt.ts` | Server plugin entry — registers 5 tools and 3 hooks |
| `src/worktrunk-sidebar.tsx` | TUI plugin entry — registers the `sidebar_content` slot, refreshes on session changes + 10s poll |

The session cwd rebind uses opencode's SDK RPC `client.session.update({ query: { directory } })` — a stable, documented API. No experimental workarounds.

## Hook approvals

Worktrunk project hooks (`.config/wt.toml`) need first-run approval. If an agent's tool call hits an unapproved hook, the plugin surfaces the error and tells the user to run `wt config approvals add`. The plugin never passes `--yes` to silence the approval gate.
