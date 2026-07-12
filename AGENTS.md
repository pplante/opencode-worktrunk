# AGENTS.md

## Workflow: Always use a worktree

**ALWAYS do development work in a worktree, never directly on `main`.** Use `worktrunk_create` (or `wt create`) to create a worktree on a new branch before making any code changes.

The ONLY exception is when the human explicitly says to work on main / directly in the current tree. Do not assume this — if unsure, create a worktree.

After finishing work in a worktree, merge it back via `worktrunk_merge` (or let the human decide integration strategy).

## Commands

- **Install deps:** `bun install`
- **Run tests:** `bun test`
- **Build check:** `bun build src/worktrunk-wt.ts --no-bundle --outfile /dev/null`
- **Install plugin:** `ln -sf "$(pwd)/src/worktrunk-wt.ts" ~/.config/opencode/plugins/worktrunk-wt.ts` then restart opencode.

## Architecture

TypeScript opencode plugin. Pure helpers in `src/` (args, parse, paths, state) are unit-tested with `bun test`. The plugin entry `src/worktrunk-wt.ts` is thin integration glue — it wires the helpers into opencode's `tool:` hook system.

Session cwd is rebound via `client.session.update({ query: { directory } })` after each create/switch/merge. No experimental APIs.

All `wt` calls use: `wt -C <projectRoot>` (pinned to stable project root from PluginInput.worktree), `--no-cd` (switch only), `--format json` (stdout), `-y` (non-interactive).

## Code Conventions

- No code comments unless explicitly requested.
- snake_case JSON fields from `wt` output are converted to camelCase in parse helpers.
- Each `wt` subcommand has a paired arg builder and parser. If adding a new command, add both.
- Pure helpers have zero side effects (no I/O, no SDK calls). All side-effectful logic lives in `worktrunk-wt.ts`.
- Tests use real JSON fixtures from probing `wt --format json`. No mocks.

## Working with the code

Pure helpers (args, parse, paths, state) are testable in isolation. The plugin entry is verified end-to-end — restart opencode after changes, then call the tools from a session.

Symlink resolution: `resolvePath` in `paths.ts` calls `realpathSync` to handle macOS `/tmp` vs `/private/tmp` differences. Used before `isUnderPath` comparisons.

## Hook approvals

Never pass `--yes` on the user's behalf to silence worktrunk hook approvals. If hooks need approval, the tool call errors and the agent should tell the user to run `wt config approvals add`.
