# worktrunk sidebar — design

**Status:** Approved (2026-07-06)
**Distribution:** Personal global plugin — `~/.config/opencode/plugins/worktrunk-sidebar.ts` (alongside the existing `worktrunk-wt.ts`)

## Goal

Add a **read-only** worktrunk worktree list to the opencode sidebar. The sidebar renders all worktrees in the repo, marks the one the current session is in as active, and stays fresh as worktrees are created, switched, merged, or removed — without any agent interaction.

## Non-goals

- Interactive sidebar rows (click-to-switch, remove from sidebar, etc.). The sidebar is display-only. Switching and removing still go through the agent's `worktrunk_switch` / `worktrunk_remove` tools.
- Dirty/clean or ahead/behind indicators per worktree. Only `branch`, `path`, `isMain`, and `active` are shown (the data `wt list --format json` already returns for free).
- Hook approval handling. The TUI plugin only ever runs `wt list`, which does not trigger project hooks. The hook-approval gate from the server plugin is unaffected.

## Architecture & files

opencode's plugin model has two mutually exclusive module kinds per file: `PluginModule` (server: tools/hooks) and `TuiPluginModule` (TUI: SolidJS rendering, slot registration). They cannot coexist in one file. Therefore the worktrunk TUI sidebar is a **separate plugin file** alongside the existing server plugin:

```
src/worktrunk-wt.ts        # existing — server plugin (5 tools, 3 hooks). UNCHANGED.
src/worktrunk-sidebar.ts   # NEW      — TUI plugin (sidebar_content slot). NEW.
src/sidebar.ts             # NEW      — pure formatter helper (tested).
src/sidebar.test.ts        # NEW      — unit tests for the formatter.
```

Both plugin files get symlinked into `~/.config/opencode/plugins/`. The TUI plugin imports the existing pure helpers — no data coupling to the server plugin's runtime state.

### Reused helpers

- `parseListResult` from `parse.ts` — parses `wt list --format json` into `ListEntry[] = { branch, path, isMain }[]`. Already tested.
- `resolvePath` / `isUnderPath` from `paths.ts` — symlink-safe path comparison, used to detect the active worktree. Already tested.
- `buildListArgs` from `args.ts` — returns `["list", "--format", "json", "-y"]`. Already tested.

### New pure helper — `src/sidebar.ts`

```ts
export type SidebarRow = {
  branch: string;
  path: string;
  basename: string;
  isMain: boolean;
  active: boolean;
};

export function formatSidebarRows(
  list: ListEntry[],
  sessionDirectory: string
): SidebarRow[];
```

Computes `active` per row via `isUnderPath(resolvePath(sessionDirectory), resolvePath(w.path))` and derives `basename` as `path.split("/").pop()`. Pure; tested in isolation like the other helpers.

### TUI plugin entry — `src/worktrunk-sidebar.ts`

Exports a `TuiPluginModule`. The `tui` function:

1. Captures `projectRoot = api.state.path.worktree` and `sessionDirectory = api.state.path.directory` at init. These do not change during the session.
2. Defines `runWtList()` — wraps `$\`wt -C ${projectRoot} list --format json -y\`.quiet().text()` with the same error-context pattern as the server plugin's `runWt` (exit code + stderr in the thrown message). Side-effectful, so it stays in the entry glue per AGENTS.md.
3. Defines `refresh()` — calls `runWtList()`, parses with `parseListResult`, formats via `formatSidebarRows`, writes to the signal. Guards against concurrent runs with a `let refreshing` flag.
4. Runs `refresh()` once on init.
5. Registers the `sidebar_content` slot via `api.slots.register`.
6. Subscribes to `api.event.on("session.updated", ...)` → calls `refresh()`.
7. Starts `setInterval(refresh, 10_000)` to catch externally-created worktrees.
8. On `api.lifecycle.onDispose`, clears the interval and calls the event unsubscribe.

The plugin never throws out of the `tui` function — load failures are caught and logged so they don't break opencode's plugin loader.

## Data flow & refresh

```
init → refresh() → wt list --format json → parseListResult → formatSidebarRows → signal
                                          ↓
                                         sidebar_content slot renders rows

session.updated event ─┐
                       ├────→ refresh() (guarded against concurrent runs)
10s interval ──────────┘
```

Refresh semantics:
- The `refreshing` flag serializes overlapping triggers (event + interval firing at once). The loser is dropped, not queued — `wt list` snaps fast enough that the next tick picks up any change.
- Refresh errors are caught and logged; the signal keeps its last-known-good value. If the first init refresh fails, the section renders as empty and hides itself (see Rendering).

## Rendering & the sidebar slot

Plugin calls `api.slots.register` with a `TuiSlotPlugin` keyed at slot `sidebar_content`. The slot's render function receives `{ session_id }` as props (unused beyond signaling which session the sidebar is for).

Layout (plain text, opentui/solid):

```
Worktrees
● branch-a
  repo-branch-a
○ branch-b
  repo-branch-b
● main        (isMain = true renders the same; bullet reflects active)
  repo-main
```

- `●` filled bullet when `active`, `○` hollow otherwise. No special treatment for `isMain` in the bullet — the row's `branch` already names it.
- `path` line is the directory `basename` of the worktree path, muted.
- Title row `Worktrees` muted.

Empty state:
- When `entries().length === 0` after the init refresh (e.g. `wt` not installed, not a worktree repo), the component renders nothing — the slot collapses the section. No dead space.
- During the gap between plugin init and the first `refresh()` completing, the signal's initial value is `[]`, so the section is also hidden briefly.

No new dependencies. `@opentui/solid`, `@opentui/core`, and `@opencode-ai/sdk/v2` are already transitive deps of `@opencode-ai/plugin`.

## Error handling

- `wt list` non-zero exit → `runWtList` throws with exit code + stderr message, `refresh()` catches and logs (`api.console.log` if available, else `console.error`). Signal stays at last-known-good; no crash.
- JSON parse failure → `parseListResult` already throws with raw output preview; caught and logged the same way.
- `wt` not on PATH → caught by the same try/catch on the init `refresh()`; sidebar stays hidden. Logged so the user can diagnose.
- Slot registration failure → caught at the top of `tui()`; logged; opencode continues without the sidebar but the server plugin is unaffected (separate module/process).
- Concurrent `refresh()` calls → `refreshing` flag drops the second; never reentrantly updates the signal.

## Testing

Pure helpers only, per AGENTS.md "Pure helpers are testable in isolation" / "The plugin entry is verified end-to-end".

### `src/sidebar.test.ts`

Verified cases:
1. Empty list → empty array → empty render → hidden section.
2. Single entry, session dir matches → `active: true`, bullet filled.
3. Multiple entries, only the one containing session dir is active.
4. Symlink edge case: session dir is `/tmp/foo`, worktree path is `/private/tmp/foo` (macOS) — `resolvePath` normalizes both, `isUnderPath` returns true. (This case already passes through `paths.test.ts`; the test here asserts the formatter composes them correctly.)
5. `isMain` flag passes through to the row unchanged.
6. `basename` of a path like `/Users/phil/Projects/repo-feat-a` returns `repo-feat-a`.
7. Paths without slashes (degenerate) return the input as basename.

No mocks. Real `ListEntry` literals as fixtures, matching the existing test style in `parse.test.ts` / `paths.test.ts`.

### End-to-end (manual, after restart)

1. Install both plugins → restart opencode.
2. Sidebar shows current repo's worktrees; the active one is filled-bulleted.
3. From a terminal, `wt switch --create foo` → within 10s the new row appears in the sidebar with hollow bullet.
4. Agent calls `worktrunk_switch branch=foo` → on the next `session.updated` (or 10s poll, whichever first) the bullet moves to `foo`; old row becomes hollow.
5. Agent calls `worktrunk_merge` → row disappears on next refresh as the worktree is removed.
6. `wt` not installed → sidebar section stays hidden; no crash; logs contain the failure.

## Install & file layout

Install steps (README update):

```bash
git clone <repo> ~/Projects/opencode-worktrunk
cd ~/Projects/opencode-worktrunk
bun install
ln -sf "$(pwd)/src/worktrunk-wt.ts"      ~/.config/opencode/plugins/worktrunk-wt.ts
ln -sf "$(pwd)/src/worktrunk-sidebar.ts"  ~/.config/opencode/plugins/worktrunk-sidebar.ts
```

Restart opencode.

Build check (AGENTS.md commands):

```bash
bun test
bun build src/worktrunk-wt.ts       --no-bundle --outfile /dev/null
bun build src/worktrunk-sidebar.ts  --no-bundle --outfile /dev/null
```

## Conventions followed

- No code comments (AGENTS.md).
- snake_case → camelCase in parse helpers — already done by `parseListResult`; reused unchanged.
- Pure helpers (`sidebar.ts`) have zero side effects. All I/O (`runWtList`, signal writes, slot registration, event subscription) lives in `worktrunk-sidebar.ts`.
- Tests use real literals (no mocks).
- New `wt` subcommand usage: `wt list` already has its paired arg builder (`buildListArgs`) and parser (`parseListResult`); both reused, no new ones added.
