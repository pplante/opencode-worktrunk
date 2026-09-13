# AGENTS.md

## Workflow: Always use a worktree

**ALWAYS do development work in a worktree, never directly on `main`.** Use `worktrunk_create` (or `wt create`) to create a worktree on a new branch before making any code changes.

The ONLY exception is when the human explicitly says to work on main / directly in the current tree. Do not assume this — if unsure, create a worktree.

After finishing work in a worktree, merge it back via `worktrunk_merge` (or let the human decide integration strategy).

## Commands

- **Install deps:** `bun install`
- **Run tests:** `bun test`
- **Typecheck:** `bun run typecheck` (tsconfig.json covers `src/`, strict)
- **Build check:** `bun run build` (emits `dist/worktrunk-wt.js` for v1, `dist/server.js` for v2)
- **Install plugin v1:** `ln -sf "$(pwd)/src/worktrunk-wt.ts" ~/.config/opencode/plugins/worktrunk-wt.ts` then restart opencode.
- **Install plugin v2:** add `@pplante/opencode-worktrunk` to `plugins` in opencode.json, then restart opencode.

## Architecture

TypeScript opencode plugin supporting v1 and v2 from separate entries over shared helpers. Pure helpers in `src/` (args, parse, paths, state, aliases, intercept, bootstrap) are unit-tested with `bun test`. `src/worktrunk-wt.ts` (v1, function export) and `src/server.ts` (v2, `Plugin.define`) are thin integration glue — each wires the helpers into its own plugin API.

Session cwd is rebound via `session.move` (v2) or the control-plane move endpoint (v1) after each create/switch/merge.

All `wt` calls use: `wt -C <projectRoot>` (v1: PluginInput.worktree, v2: `ctx.location.project.canonical`), `--no-cd` (switch only), `--format json` (stdout), `-y` (non-interactive). V2 runs `wt` via `node:child_process` since the v2 context provides no Bun `$` helper.

## Code Conventions

- No code comments unless explicitly requested.
- snake_case JSON fields from `wt` output are converted to camelCase in parse helpers.
- Each `wt` subcommand has a paired arg builder and parser. If adding a new command, add both.
- Pure helpers have zero side effects (no I/O, no SDK calls). All side-effectful logic lives in the entries (`worktrunk-wt.ts`, `server.ts`).
- Tests use real JSON fixtures from probing `wt --format json`. No mocks.

## Working with the code

Pure helpers (args, parse, paths, state) are testable in isolation. The plugin entries are verified end-to-end — restart opencode after changes, then call the tools from a session. The v2 entry can also be smoke-tested headless: import `dist/server.js` with a stub ctx and drive the registered tools against real `wt`.

Symlink resolution: `resolvePath` in `paths.ts` calls `realpathSync` to handle macOS `/tmp` vs `/private/tmp` differences. Used before `isUnderPath` comparisons.

## Hook approvals

Never pass `--yes` on the user's behalf to silence worktrunk hook approvals. If hooks need approval, the tool call errors and the agent should tell the user to run `wt config approvals add`.
