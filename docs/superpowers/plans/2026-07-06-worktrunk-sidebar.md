# worktrunk sidebar Implementation Plan

> **STATUS: BLOCKED (2026-07-06).** Do not resume without first resolving the cwd-rebind blocker documented in `docs/superpowers/notes/cwd-rebind-broken.md`. The sidebar itself is display-only and unaffected, but the server plugin's 5 tools (`worktrunk_create/switch/merge/list/remove`) silently fail to rebind the session cwd on opencode 1.17.13/1.17.14 — so an end-to-end verification of "agent switches → sidebar updates" won't work. The sidebar TUI plugin can still be built and rendered independently once we decide how to handle the rebind gap.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only worktree list to the opencode sidebar that shows every worktree in the repo, marks the active one, and refreshes on session directory changes plus a 10s interval poll.

**Architecture:** A separate TUI plugin module (`worktrunk-sidebar.ts`) registers into opencode's `sidebar_content` slot and renders a SolidJS list. It shells out to `wt list --format json` via Bun's `$`, reuses the existing pure helpers (`parseListResult`, `resolvePath`, `isUnderPath`, `buildListArgs`), and adds one new pure helper (`formatSidebarRows` in `sidebar.ts`) that is unit-tested in isolation.

**Tech Stack:** TypeScript, opencode plugin SDK (`@opencode-ai/plugin`), `@opentui/solid`, `@opentui/core`, Bun's shell (`$`), `bun:test`.

## Global Constraints

- Target CLI: worktrunk (`wt`) v0.65.0+ on PATH. All `wt` calls use `-C <projectRoot>` (pinned to `api.state.path.worktree`), `--format json` (stdout), `-y` (non-interactive).
- opencode plugin SDK v1.15.13 is already a dependency — no new packages.
- No code comments unless explicitly requested (AGENTS.md).
- Pure helpers have zero side effects; all I/O lives in `worktrunk-sidebar.ts` entry glue.
- Tests use real JSON literals as fixtures, no mocks (AGENTS.md).
- snake_case JSON fields from `wt` output are converted to camelCase in parse helpers (AGENTS.md) — already done by `parseListResult`; this plan reuses it unchanged.
- `PluginModule` (server) and `TuiPluginModule` (TUI) are mutually exclusive per-file in opencode — that's why the sidebar is a separate file from `worktrunk-wt.ts`.
- `wt list` does not trigger project hooks, so no `--no-hooks` flag and no hook-approval gate applies to the TUI plugin.
- The server plugin `src/worktrunk-wt.ts` is **not modified** by this plan.

---

## File Structure

```
src/sidebar.ts             # NEW - pure helper: formatSidebarRows(list, sessionDir) -> SidebarRow[]
src/sidebar.test.ts        # NEW - unit tests for formatSidebarRows
src/worktrunk-sidebar.ts   # NEW - TUI plugin entry: slot registration, refresh, render
```

Files unchanged: `args.ts`, `parse.ts`, `paths.ts`, `state.ts`, `worktrunk-wt.ts`, all existing tests.

---

## Task 1: Pure helper `formatSidebarRows`

**Files:**
- Create: `src/sidebar.ts`
- Test: `src/sidebar.test.ts`

**Interfaces:**
- Consumes:
  - `ListEntry` from `./parse` (type: `{ branch: string; path: string; isMain: boolean }`)
  - `resolvePath` from `./paths` (signature: `(p: string) => string`)
  - `isUnderPath` from `./paths` (signature: `(childPath: string, parentPath: string) => boolean`)
- Produces:
  - `SidebarRow` type: `{ branch: string; path: string; basename: string; isMain: boolean; active: boolean }`
  - `formatSidebarRows(list: ListEntry[], sessionDirectory: string): SidebarRow[]`

- [ ] **Step 1: Write the failing tests**

Create `src/sidebar.test.ts`:

```ts
import { test, expect } from "bun:test";
import { formatSidebarRows } from "./sidebar";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

test("empty list returns empty array", () => {
  expect(formatSidebarRows([], "/some/dir")).toEqual([]);
});

test("single entry matching session dir is active", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wt-sidebar-"));
  const list = [{ branch: "main", path: dir, isMain: true }];
  const result = formatSidebarRows(list, dir);
  expect(result).toHaveLength(1);
  expect(result[0].active).toBe(true);
  expect(result[0].basename).toBe(path.basename(dir));
  expect(result[0].isMain).toBe(true);
  expect(result[0].branch).toBe("main");
});

test("multiple entries - only matching session dir is active", () => {
  const dirA = mkdtempSync(path.join(tmpdir(), "wt-a-"));
  const dirB = mkdtempSync(path.join(tmpdir(), "wt-b-"));
  const list = [
    { branch: "a", path: dirA, isMain: false },
    { branch: "b", path: dirB, isMain: false },
  ];
  const result = formatSidebarRows(list, dirB);
  expect(result[0].active).toBe(false);
  expect(result[1].active).toBe(true);
});

test("isMain flag passes through", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wt-main-"));
  const list = [{ branch: "main", path: dir, isMain: true }];
  const result = formatSidebarRows(list, dir);
  expect(result[0].isMain).toBe(true);
});

test("basename is the last path segment", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "repo-feat-a-"));
  const list = [{ branch: "feat-a", path: dir, isMain: false }];
  const result = formatSidebarRows(list, dir);
  expect(result[0].basename).toBe(path.basename(dir));
});

test("path without slashes returns input as basename", () => {
  const list = [{ branch: "x", path: "nodirs", isMain: false }];
  const result = formatSidebarRows(list, "/totally/different");
  expect(result[0].basename).toBe("nodirs");
  expect(result[0].active).toBe(false);
});

test("symlink-active child path resolves to parent worktree", () => {
  const real = mkdtempSync(path.join(tmpdir(), "real-wt-"));
  const alias = path.join(tmpdir(), "alias-wt-" + Date.now());
  writeFileSync(alias, "", { flag: "w" });
  const list = [{ branch: "main", path: real, isMain: true }];
  const result = formatSidebarRows(list, alias);
  expect(result[0].active).toBe(false);
});
```

Explanation: the symlink test asserts that two unrelated paths (an empty alias file and a real tempdir) are not considered the same worktree. The macOS `/tmp` ↔ `/private/tmp` resolution is exercised through `resolvePath`'s `realpathSync`; the existing `paths.test.ts` covers the same-path-symlink case, so this test only confirms the composition in `formatSidebarRows` doesn't accidentally widen the match.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/sidebar.test.ts`
Expected: FAIL — `Cannot find module "./sidebar"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/sidebar.ts`:

```ts
import { isUnderPath, resolvePath } from "./paths";
import type { ListEntry } from "./parse";

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
): SidebarRow[] {
  const session = resolvePath(sessionDirectory);
  return list.map((w) => {
    const resolvedWt = resolvePath(w.path);
    const basename = w.path.split("/").pop() ?? w.path;
    return {
      branch: w.branch,
      path: w.path,
      basename,
      isMain: w.isMain,
      active: isUnderPath(session, resolvedWt),
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/sidebar.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Run full test suite + build check**

Run: `bun test`
Expected: PASS — no regressions in existing tests.

Run: `bun build src/worktrunk-wt.ts --no-bundle --outfile /dev/null`
Expected: PASS — existing plugin still builds.

- [ ] **Step 6: Commit**

```bash
git add src/sidebar.ts src/sidebar.test.ts
git commit -m "feat: add formatSidebarRows pure helper for sidebar rendering"
```

---

## Task 2: TUI plugin entry — slot registration, refresh, render

**Files:**
- Create: `src/worktrunk-sidebar.ts`

**Interfaces:**
- Consumes:
  - `buildListArgs` from `./args` (signature: `() => string[]`, returns `["list","--format","json","-y"]`)
  - `parseListResult` from `./parse` (signature: `(stdout: string) => ListEntry[]`)
  - `formatSidebarRows` from `./sidebar` (signature: `(list: ListEntry[], sessionDirectory: string) => SidebarRow[]`)
  - opencode plugin SDK types: `TuiPlugin`, `TuiPluginModule`, `TuiPluginApi` (from `@opencode-ai/plugin`)
  - opentui/solid JSX + `createSignal` (transitive dep of `@opencode-ai/plugin`)
- Produces: a default-exported `TuiPluginModule` consumed by opencode's plugin loader.

- [ ] **Step 1: Write the plugin entry**

Create `src/worktrunk-sidebar.ts`:

```ts
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin";
import { buildListArgs } from "./args";
import { parseListResult } from "./parse";
import { formatSidebarRows } from "./sidebar";
import type { SidebarRow } from "./sidebar";
import { createSignal, onCleanup } from "solid-js";

const tui: TuiPlugin = async (api) => {
  const projectRoot = api.state.path.worktree;
  const [rows, setRows] = createSignal<SidebarRow[]>([]);
  let refreshing = false;

  async function runWtList(): Promise<string> {
    try {
      const $ = (globalThis as any).Bun.$.-shell;
      return await $`wt -C ${projectRoot} ${buildListArgs()}`.quiet().text();
    } catch (err: any) {
      const stderr = err.stderr || err.stdout || err.message || "";
      throw new Error(
        `wt list failed (exit ${err.exitCode}): ${stderr.trim()}`
      );
    }
  }

  async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      const stdout = await runWtList();
      const list = parseListResult(stdout);
      const sessionDirectory = api.state.path.directory;
      setRows(formatSidebarRows(list, sessionDirectory));
    } catch (err: any) {
      console.error("[worktrunk-sidebar] refresh failed:", err.message);
    } finally {
      refreshing = false;
    }
  }

  await refresh();

  const offEvent = api.event.on("session.updated", () => {
    void refresh();
  });

  const interval = setInterval(() => {
    void refresh();
  }, 10_000);

  api.lifecycle.onDispose(() => {
    offEvent();
    clearInterval(interval);
  });

  api.slots.register({
    render: () => {
      const current = rows();
      if (current.length === 0) return null;
      return (
        <box flexDirection="column">
          <text color={api.theme.current.textMuted}>Worktrees</text>
          {current.map((row) => (
            <box flexDirection="column">
              <text>
                {row.active ? "● " : "○ "}
                {row.branch}
              </text>
              <text color={api.theme.current.textMuted}>  {row.basename}</text>
            </box>
          ))}
        </box>
      );
    },
  });
};

const module: TuiPluginModule = { tui };
export default module;
```

Notes on the implementation that the implementer MUST follow exactly:
- The `$` shell is obtained off `globalThis.Bun.$` because the TUI plugin module does not receive `PluginInput.$` (that's only on server plugins). The `(globalThis as any).Bun.$.shell` access is the documented way to use Bun's shell from a TUI plugin context. If `Bun` is not available (non-Bun runtime), `runWtList` throws and the section stays hidden — that's the documented failure mode in the spec.
- `api.state.path.worktree` and `api.state.path.directory` are accessed lazily inside `refresh()` for the directory (it can change after a `session.update`); `projectRoot` is captured once because opencode pins it for the life of the process.
- Empty-state handling: the `render` function returns `null` when `rows().length === 0`, which collapses the slot — no dead space in the sidebar.
- The `refreshing` flag serializes overlapping triggers; the second caller is dropped (not queued).
- No code comments (AGENTS.md).
- No new dependencies are installed. `solid-js` is a transitive dep of `@opencode-ai/plugin` via `@opentui/solid`.

- [ ] **Step 2: Build-check the new plugin entry**

Run: `bun build src/worktrunk-sidebar.ts --no-bundle --outfile /dev/null`
Expected: PASS — TypeScript compiles, no syntax/type errors.
If `bun build` reports missing `solid-js` types, install it as a dev dependency:

```bash
bun add -d solid-js
```

Then re-run the build check. Note: only do this if the build fails — `solid-js` may already be resolvable through `@opentui/solid`.

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: PASS — no regressions; the existing tests are unaffected (the new entry file has no unit tests by design — AGENTS.md says the plugin entry is verified end-to-end).

- [ ] **Step 4: Self-instrument with a one-off smoke check (manual)**

The implementer does NOT commit any change here, but performs the following to verify the file is loadable:

Run: `bun -e 'import("./src/worktrunk-sidebar.ts").then(m => console.log(typeof m.default, Object.keys(m.default))).catch(e => { console.error(e); process.exit(1); })'`
Expected: prints `object [ 'tui' ]` — the module exports a `TuiPluginModule` with a `tui` function.

If this fails, **stop** — fix the import/types before continuing. The plugin won't load in opencode if this fails.

- [ ] **Step 5: Commit**

```bash
git add src/worktrunk-sidebar.ts
git commit -m "feat: add worktrunk-sidebar TUI plugin (sidebar_content slot)"
```

---

## Task 3: Install instructions + README

**Files:**
- Modify: `README.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update the Install section of README.md**

In `README.md`, replace the existing install code block:

```bash
git clone <repo> ~/Projects/opencode-wt
cd ~/Projects/opencode-wt
bun install
ln -sf "$(pwd)/src/worktrunk-wt.ts" ~/.config/opencode/plugins/worktrunk-wt.ts
```

with:

```bash
git clone <repo> ~/Projects/opencode-wt
cd ~/Projects/opencode-wt
bun install
ln -sf "$(pwd)/src/worktrunk-wt.ts"      ~/.config/opencode/plugins/worktrunk-wt.ts
ln -sf "$(pwd)/src/worktrunk-sidebar.ts"  ~/.config/opencode/plugins/worktrunk-sidebar.ts
```

- [ ] **Step 2: Update the "What it does" section**

In `README.md`, after the existing five bullet points (ending with `worktrunk_remove`), add this new bullet:

```
- **worktrunk sidebar** — A sidebar panel that lists every worktree in the repo and highlights the active one. Auto-refreshes on session switches and every 10s. Read-only; switching/removing still goes through the tools above.
```

- [ ] **Step 3: Update the Architecture table**

In `README.md`, replace the table:

```
| File | Responsibility |
|---|---|
| `src/paths.ts` | `isUnderPath`, `resolvePath` — path comparison and symlink resolution |
| `src/parse.ts` | Parsers for `wt --format json` output (switch, list, merge, remove) |
| `src/args.ts` | CLI argument builders for each `wt` subcommand |
| `src/state.ts` | Per-session state map (active worktree path + branch) |
| `src/worktrunk-wt.ts` | Plugin entry — registers 5 tools and 3 hooks |
```

with:

```
| File | Responsibility |
|---|---|
| `src/paths.ts` | `isUnderPath`, `resolvePath` — path comparison and symlink resolution |
| `src/parse.ts` | Parsers for `wt --format json` output (switch, list, merge, remove) |
| `src/args.ts` | CLI argument builders for each `wt` subcommand |
| `src/state.ts` | Per-session state map (active worktree path + branch) |
| `src/sidebar.ts` | Pure helper: `formatSidebarRows` — turns `ListEntry[]` into renderable rows |
| `src/worktrunk-wt.ts` | Server plugin entry — registers 5 tools and 3 hooks |
| `src/worktrunk-sidebar.ts` | TUI plugin entry — registers the `sidebar_content` slot, refreshes on session changes + 10s poll |
```

- [ ] **Step 4: Verify README renders cleanly**

Run: `bun test`
Expected: PASS (sanity — no accidental file changes).

Manually skim `README.md` to confirm the install block has both `ln -sf` lines and the new bullet under "What it does".

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add worktrunk-sidebar install + architecture entry"
```

---

## Task 4: End-to-end verification (manual)

**Files:** none modified.

**Interfaces:** none.

This task has no code to commit — it's the manual end-to-end verification step specified in the design doc. The implementer runs it after Task 3 to confirm the plugin loads and renders correctly inside opencode.

- [ ] **Step 1: Install both plugins**

Run from the repo root:

```bash
ln -sf "$(pwd)/src/worktrunk-wt.ts"      ~/.config/opencode/plugins/worktrunk-wt.ts
ln -sf "$(pwd)/src/worktrunk-sidebar.ts" ~/.config/opencode/plugins/worktrunk-sidebar.ts
```

- [ ] **Step 2: Restart opencode and observe sidebar**

Restart opencode in a worktree-enabled repo. Expected: the sidebar shows a `Worktrees` section with one row per worktree; the active one (matching the current session's directory) has a `●` bullet, others have `○`.

If the sidebar does not appear, check opencode's logs for plugin load errors. The most likely failure is `solid-js` types missing — re-run Task 2 Step 2's `bun add -d solid-js` if needed.

- [ ] **Step 3: Verify refresh on external worktree creation**

From a separate terminal in the same repo, run:

```bash
wt switch --create sidebar-test-branch --no-cd --format json -y
```

Within 10 seconds the sidebar in opencode should show a new row for `sidebar-test-branch` with a hollow bullet.

Cleanup:

```bash
wt remove sidebar-test-branch -y
```

The row should disappear on the next refresh.

- [ ] **Step 4: Verify refresh on agent-driven switch**

In the opencode session, ask the agent to call `worktrunk_switch branch=sidebar-test-branch`. The sidebar's active bullet should move to `sidebar-test-branch` on the next `session.updated` event (within a second or two of the switch completing).

Ask the agent to call `worktrunk_switch branch=<previous-branch>` to return. The bullet should move back.

- [ ] **Step 5: Verify merge hides the row**

With the agent in a feature worktree, ask it to call `worktrunk_merge`. The row for the merged feature branch should disappear on the next refresh (worktree was removed by `wt merge`).

- [ ] **Step 6: Verify `wt` not on PATH degrades gracefully**

Temporarily rename `wt` on PATH (or set `PATH` to exclude it) and restart opencode. The sidebar's `Worktrees` section should stay hidden (empty render → collapsed slot); no crash; opencode's logs should contain `[worktrunk-sidebar] refresh failed:` lines. Restore `wt` afterward.

No commit — verification only.
