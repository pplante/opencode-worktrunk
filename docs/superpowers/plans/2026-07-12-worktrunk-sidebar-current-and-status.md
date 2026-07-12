# worktrunk sidebar — current-first layout + status icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the worktrunk sidebar so the current worktree is always visible at the top, with other worktrees under a separately collapsible "Other" section, and add per-row status icons (dirty/ahead/behind/integrated) derived from `wt list --format json` fields.

**Architecture:** Extend the existing pure parse layer (`parse.ts`) to capture status fields from `wt list`, then extend the pure sidebar helpers (`sidebar.ts`) with a `statusIcon` derivation and a `current`/`others` partition. The TUI entry (`worktrunk-sidebar.tsx`) restructures its render: current-on-top (always), collapsible "Other" for the rest, status string per row, path line removed.

**Tech Stack:** TypeScript, opencode plugin SDK (`@opencode-ai/plugin`), `@opentui/solid`, Bun's shell (`$`), `bun:test`.

## Global Constraints

- Target CLI: worktrunk (`wt`) v0.65.0+ on PATH. All `wt` calls use `-C <projectRoot>`, `--format json` (stdout), `-y` (non-interactive).
- No code comments unless explicitly requested (AGENTS.md).
- Pure helpers have zero side effects; all I/O lives in `worktrunk-sidebar.tsx`.
- Tests use real JSON literals/fixtures, no mocks (AGENTS.md).
- snake_case JSON fields from `wt` are converted to camelCase in parse helpers (AGENTS.md).
- The server plugin `src/worktrunk-wt.ts` is **not modified** by this plan.
- opencode TUI plugin module must export `{ id, tui }` with a runtime `id` (project constraint #168).

---

## File Structure

```
src/parse.ts              # MODIFY - extend ListEntry + parseListResult with status fields
src/parse.test.ts         # MODIFY or CREATE - add status-field parse test (real JSON fixture)
src/sidebar.ts            # MODIFY - new SidebarRow shape, statusIcon(), partitionRows()
src/sidebar.test.ts       # MODIFY - update existing fixtures for new shape + add statusIcon/partition tests
src/worktrunk-sidebar.tsx # MODIFY - restructure render: current-on-top + collapsible Other
```

Files unchanged: `args.ts`, `paths.ts`, `state.ts`, `worktrunk-wt.ts`, all other tests.

---

## Task 1: Extend `parse.ts` to capture status fields

**Files:**
- Modify: `src/parse.ts`
- Test: `src/parse.test.ts` (create if absent; otherwise append)

**Interfaces:**
- Consumes: raw `wt list --format json` array (snake_case fields `is_current`, `is_previous`, `main_state`, `working_tree.{modified,staged,untracked,renamed,deleted}`, and either `remote.{ahead,behind}` for the main worktree or `main.{ahead,behind}` for feature worktrees).
- Produces:
  - `ListEntry` (extended, additive — existing `branch`/`path`/`isMain` unchanged):
    ```ts
    export type ListEntry = {
      branch: string;
      path: string;
      isMain: boolean;
      isCurrent: boolean;
      isPrevious: boolean;
      mainState?: string;
      ahead: number;
      behind: number;
      dirty: boolean;
    };
    ```
  - `parseListResult(stdout: string): ListEntry[]` — unchanged signature, now populates the new fields.

- [ ] **Step 1: Write the failing test**

Append to `src/parse.test.ts` (create the file with the standard `import { test, expect } from "bun:test"` header if it does not exist):

```ts
import { test, expect } from "bun:test";
import { parseListResult } from "./parse";

const FIXTURE = JSON.stringify([
  {
    branch: "main",
    path: "/repo/main",
    kind: "worktree",
    is_main: true,
    is_current: true,
    is_previous: false,
    main_state: "is_main",
    working_tree: { staged: false, modified: true, untracked: false, renamed: false, deleted: false },
    remote: { name: "origin", branch: "main", ahead: 3, behind: 0 },
  },
  {
    branch: "feat",
    path: "/repo/feat",
    kind: "worktree",
    is_main: false,
    is_current: false,
    is_previous: true,
    main_state: "integrated",
    integration_reason: "ancestor",
    working_tree: { staged: false, modified: false, untracked: false, renamed: false, deleted: false },
    main: { ahead: 0, behind: 15 },
  },
]);

test("parseListResult maps status fields to camelCase", () => {
  const rows = parseListResult(FIXTURE);
  expect(rows).toHaveLength(2);

  const main = rows[0];
  expect(main.branch).toBe("main");
  expect(main.isMain).toBe(true);
  expect(main.isCurrent).toBe(true);
  expect(main.isPrevious).toBe(false);
  expect(main.mainState).toBe("is_main");
  expect(main.ahead).toBe(3);
  expect(main.behind).toBe(0);
  expect(main.dirty).toBe(true);

  const feat = rows[1];
  expect(feat.isCurrent).toBe(false);
  expect(feat.isPrevious).toBe(true);
  expect(feat.mainState).toBe("integrated");
  expect(feat.ahead).toBe(0);
  expect(feat.behind).toBe(15);
  expect(feat.dirty).toBe(false);
});

test("parseListResult falls back to 0 ahead/behind when neither remote nor main present", () => {
  const minimal = JSON.stringify([{ branch: "x", path: "/x", is_main: false }]);
  const rows = parseListResult(minimal);
  expect(rows[0].ahead).toBe(0);
  expect(rows[0].behind).toBe(0);
  expect(rows[0].dirty).toBe(false);
  expect(rows[0].isCurrent).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/parse.test.ts`
Expected: FAIL — `isCurrent`/`mainState`/`ahead`/`behind`/`dirty` are `undefined` (parser does not populate them yet).

- [ ] **Step 3: Implement the parser changes**

Replace the `ListEntry` type and `parseListResult` in `src/parse.ts` with:

```ts
export type ListEntry = {
  branch: string;
  path: string;
  isMain: boolean;
  isCurrent: boolean;
  isPrevious: boolean;
  mainState?: string;
  ahead: number;
  behind: number;
  dirty: boolean;
};
```

```ts
type RawWorkingTree = {
  staged?: boolean;
  modified?: boolean;
  untracked?: boolean;
  renamed?: boolean;
  deleted?: boolean;
};

type RawListEntry = {
  branch: string;
  path: string;
  is_main?: boolean;
  is_current?: boolean;
  is_previous?: boolean;
  main_state?: string;
  working_tree?: RawWorkingTree;
  remote?: { ahead?: number; behind?: number };
  main?: { ahead?: number; behind?: number };
};

function isDirty(wt: RawWorkingTree | undefined): boolean {
  if (!wt) return false;
  return Boolean(
    wt.modified || wt.staged || wt.untracked || wt.renamed || wt.deleted
  );
}

export function parseListResult(stdout: string): ListEntry[] {
  const raw = parseJson<RawListEntry[]>(stdout, "parseListResult");
  return raw.map((w) => {
    const sync = w.remote ?? w.main ?? {};
    return {
      branch: w.branch,
      path: w.path,
      isMain: w.is_main ?? false,
      isCurrent: w.is_current ?? false,
      isPrevious: w.is_previous ?? false,
      mainState: w.main_state,
      ahead: sync.ahead ?? 0,
      behind: sync.behind ?? 0,
      dirty: isDirty(w.working_tree),
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/parse.test.ts`
Expected: PASS — both new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/parse.ts src/parse.test.ts
git commit -m "feat(parse): capture status fields in ListEntry from wt list"
```

---

## Task 2: Extend `sidebar.ts` — new `SidebarRow`, `statusIcon`, `partitionRows`

**Files:**
- Modify: `src/sidebar.ts`
- Test: `src/sidebar.test.ts`

**Interfaces:**
- Consumes:
  - `ListEntry` from `./parse` (the extended type from Task 1).
  - `resolvePath`, `isUnderPath` from `./paths` (unchanged).
- Produces:
  - `SidebarRow`:
    ```ts
    export type SidebarRow = {
      branch: string;
      path: string;
      status: string;
      isMain: boolean;
      isCurrent: boolean;
      isPrevious: boolean;
      active: boolean;
    };
    ```
  - `formatSidebarRows(list: ListEntry[], sessionDirectory: string): SidebarRow[]`
  - `statusIcon(dirty: boolean, ahead: number, behind: number, integrated: boolean): string`
  - `partitionRows(rows: SidebarRow[]): { current: SidebarRow | null; others: SidebarRow[] }`

- [ ] **Step 1: Write the failing tests**

Append these tests to `src/sidebar.test.ts`:

```ts
import { statusIcon, partitionRows } from "./sidebar";

test("statusIcon: clean and in-sync returns empty string", () => {
  expect(statusIcon(false, 0, 0, false)).toBe("");
});

test("statusIcon: dirty shows *", () => {
  expect(statusIcon(true, 0, 0, false)).toBe("*");
});

test("statusIcon: ahead shows arrow with count", () => {
  expect(statusIcon(false, 3, 0, false)).toBe("↑3");
});

test("statusIcon: behind shows arrow with count", () => {
  expect(statusIcon(false, 0, 2, false)).toBe("↓2");
});

test("statusIcon: integrated shows check", () => {
  expect(statusIcon(false, 0, 0, true)).toBe("✓");
});

test("statusIcon: combined dirty + ahead + integrated", () => {
  expect(statusIcon(true, 3, 0, true)).toBe("* ↑3 ✓");
});

test("statusIcon: dirty + behind, no integrated", () => {
  expect(statusIcon(true, 0, 5, false)).toBe("* ↓5");
});

test("partitionRows: current is the active row", () => {
  const rows = [
    { branch: "a", path: "/a", status: "", isMain: false, isCurrent: false, isPrevious: false, active: false },
    { branch: "b", path: "/b", status: "", isMain: false, isCurrent: true, isPrevious: false, active: true },
  ];
  const { current, others } = partitionRows(rows);
  expect(current?.branch).toBe("b");
  expect(others).toHaveLength(1);
  expect(others[0].branch).toBe("a");
});

test("partitionRows: falls back to isCurrent when none active", () => {
  const rows = [
    { branch: "a", path: "/a", status: "", isMain: false, isCurrent: true, isPrevious: false, active: false },
    { branch: "b", path: "/b", status: "", isMain: false, isCurrent: false, isPrevious: false, active: false },
  ];
  const { current, others } = partitionRows(rows);
  expect(current?.branch).toBe("a");
  expect(others).toHaveLength(1);
  expect(others[0].branch).toBe("b");
});

test("partitionRows: no current or active returns null current", () => {
  const rows = [
    { branch: "a", path: "/a", status: "", isMain: false, isCurrent: false, isPrevious: false, active: false },
  ];
  const { current, others } = partitionRows(rows);
  expect(current).toBeNull();
  expect(others).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/sidebar.test.ts`
Expected: FAIL — `statusIcon` and `partitionRows` not exported; also existing `formatSidebarRows` tests fail on removed `basename` field.

- [ ] **Step 3: Update the existing test fixtures for the new SidebarRow shape**

In `src/sidebar.test.ts`, every `ListEntry` literal passed to `formatSidebarRows` must now include the new `ListEntry` fields, and every assertion reading `.basename` must be removed (the field no longer exists). Apply these edits:

For the `single entry matching session dir is active` test, change the list literal to:
```ts
const list = [{ branch: "main", path: dir, isMain: true, isCurrent: true, isPrevious: false, ahead: 0, behind: 0, dirty: false }];
```
and remove the line `expect(result[0].basename).toBe(path.basename(dir));`.

For `multiple entries - only matching session dir is active`, change both list entries:
```ts
const list = [
  { branch: "a", path: dirA, isMain: false, isCurrent: false, isPrevious: false, ahead: 0, behind: 0, dirty: false },
  { branch: "b", path: dirB, isMain: false, isCurrent: true, isPrevious: false, ahead: 0, behind: 0, dirty: false },
];
```

For `isMain flag passes through`, change the list literal to:
```ts
const list = [{ branch: "main", path: dir, isMain: true, isCurrent: true, isPrevious: false, ahead: 0, behind: 0, dirty: false }];
```

Delete the entire `basename is the last path segment` test (basename field removed).

Delete the entire `path without slashes returns input as basename` test (basename field removed).

For `symlink-active child path resolves to parent worktree`, change the list literal to:
```ts
const list = [{ branch: "main", path: real, isMain: true, isCurrent: false, isPrevious: false, ahead: 0, behind: 0, dirty: false }];
```

- [ ] **Step 4: Implement the new `sidebar.ts`**

Replace the entire contents of `src/sidebar.ts` with:

```ts
import { isUnderPath, resolvePath } from "./paths";
import type { ListEntry } from "./parse";

export type SidebarRow = {
  branch: string;
  path: string;
  status: string;
  isMain: boolean;
  isCurrent: boolean;
  isPrevious: boolean;
  active: boolean;
};

export function statusIcon(
  dirty: boolean,
  ahead: number,
  behind: number,
  integrated: boolean,
): string {
  const parts: string[] = [];
  if (dirty) parts.push("*");
  if (ahead > 0) parts.push(`↑${ahead}`);
  if (behind > 0) parts.push(`↓${behind}`);
  if (integrated) parts.push("✓");
  return parts.join(" ");
}

export function formatSidebarRows(
  list: ListEntry[],
  sessionDirectory: string,
): SidebarRow[] {
  const session = resolvePath(sessionDirectory);
  return list.map((w) => {
    const resolvedWt = resolvePath(w.path);
    const integrated = w.mainState === "integrated";
    return {
      branch: w.branch,
      path: w.path,
      status: statusIcon(w.dirty, w.ahead, w.behind, integrated),
      isMain: w.isMain,
      isCurrent: w.isCurrent,
      isPrevious: w.isPrevious,
      active: isUnderPath(session, resolvedWt),
    };
  });
}

export function partitionRows(rows: SidebarRow[]): {
  current: SidebarRow | null;
  others: SidebarRow[];
} {
  const current = rows.find((r) => r.active) ?? rows.find((r) => r.isCurrent) ?? null;
  const currentIdx = current ? rows.indexOf(current) : -1;
  const others = rows.filter((_, i) => i !== currentIdx);
  return { current, others };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/sidebar.test.ts`
Expected: PASS — all existing (updated) and new tests green.

- [ ] **Step 6: Run full test suite to confirm no regressions**

Run: `bun test`
Expected: PASS — all tests green (parse + sidebar + others).

- [ ] **Step 7: Commit**

```bash
git add src/sidebar.ts src/sidebar.test.ts
git commit -m "feat(sidebar): status icons + current/others partition"
```

---

## Task 3: Restructure `worktrunk-sidebar.tsx` render

**Files:**
- Modify: `src/worktrunk-sidebar.tsx`

**Interfaces:**
- Consumes:
  - `formatSidebarRows`, `partitionRows`, `SidebarRow` from `./sidebar` (Task 2).
  - `parseListResult`, `buildListArgs` unchanged.
  - opencode `TuiPlugin` API: `api.state.path.worktree`, `api.state.path.directory`, `api.theme.current`, `api.event`, `api.lifecycle`, `api.slots`.

No unit tests for this task — the entry is verified by build + manual restart (AGENTS.md: entry glue is thin integration, verified end-to-end).

- [ ] **Step 1: Update the imports**

In `src/worktrunk-sidebar.tsx`, change the import from `./sidebar` to bring in the new helpers:

```tsx
import { formatSidebarRows, partitionRows } from "./sidebar";
```

Remove the now-unused `SidebarRow` type import if it is no longer referenced directly (the signal can stay typed as `SidebarRow[]` — keep the type import only if still used; the `rows` signal uses it, so retain: `import type { SidebarRow } from "./sidebar";`).

- [ ] **Step 2: Rewrite the `sidebar_content` slot render**

Replace the entire `api.slots.register({ slots: { sidebar_content: () => { ... } } })` block (the body that currently partitions on `r.active` and renders a single collapsible) with this render:

```tsx
api.slots.register({
  slots: {
    sidebar_content: () => {
      const all = rows();
      const t = theme.current;
      const { current, others } = partitionRows(all);
      const toggle = () => setCollapsed(!collapsed());
      return (
        <box
          width="100%"
          flexDirection="column"
          border={SINGLE_BORDER}
          borderColor={t.borderActive}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={1}
          paddingRight={1}
        >
          <box
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <box paddingLeft={1} paddingRight={1} backgroundColor={t.accent}>
              <text fg={t.background}>
                <b>{"Worktrees"}</b>
              </text>
            </box>
            <text fg={t.textMuted}>{all.length}</text>
          </box>

          {current && (
            <box flexDirection="row" marginTop={1} justifyContent="space-between">
              <box flexDirection="row">
                <text fg={t.accent}>● </text>
                <text fg={t.text}>
                  <b>{current.branch}</b>
                </text>
              </box>
              {current.status.length > 0 && (
                <text fg={t.textMuted}> {current.status}</text>
              )}
            </box>
          )}

          {others.length > 0 && (
            <box flexDirection="column" marginTop={1}>
              <box
                flexDirection="row"
                justifyContent="space-between"
                alignItems="center"
                onMouseDown={() => toggle()}
              >
                <text fg={t.textMuted}>
                  <b>{collapsed() ? "▶ " : "▼ "}Other</b>
                </text>
                <text fg={t.textMuted}>{others.length}</text>
              </box>

              {!collapsed() && (
                <box flexDirection="column" marginTop={1}>
                  {others.map((row) => (
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={t.textMuted}>○ {row.branch}</text>
                      {row.status.length > 0 && (
                        <text fg={t.textMuted}> {row.status}</text>
                      )}
                    </box>
                  ))}
                </box>
              )}
            </box>
          )}

          {all.length === 0 && (
            <text fg={t.textMuted}> {error() ? "(error)" : "(none)"}</text>
          )}
        </box>
      );
    },
  },
});
```

Key behavioral changes vs. the old render:
- The top-level "Worktrees" header is no longer the collapse toggle; it is always visible (it stays the section title).
- The current worktree is rendered directly under the header, always visible, regardless of `collapsed`.
- The collapse toggle now lives on the "Other" sub-header and governs only the non-current rows.
- The `basename` path line is removed entirely.
- Each row shows its `status` string right-aligned in muted color when non-empty.
- The `collapsed && activeRow` fallback block is removed (current is always shown).
- Empty/error state is handled by a single `(none)`/`(error)` line when `all.length === 0`.

- [ ] **Step 3: Build check**

Run: `bun build src/worktrunk-sidebar.tsx --no-bundle --outfile /dev/null`
Expected: compiles with no errors.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: PASS — all tests green (no behavioral change to pure helpers in this task).

- [ ] **Step 5: Commit**

```bash
git add src/worktrunk-sidebar.tsx
git commit -m "feat(sidebar): current-on-top layout, collapsible Others, status icons"
```

---

## Task 4: Verification

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: all PASS.

- [ ] **Step 2: Build the plugin entry**

Run: `bun build src/worktrunk-sidebar.tsx --no-bundle --outfile /dev/null`
Expected: no errors.

- [ ] **Step 3: Manual end-to-end check**

The plugin is symlinked from `~/.config/opencode/plugins/worktrunk-wt.ts` (server) and registered in `~/.config/opencode/tui.json` at `/Users/phil/Projects/opencode-wt/src/worktrunk-sidebar.tsx`. Restart opencode and confirm:
1. Current worktree appears at the top, always visible.
2. "Other" header is present only when there are non-current worktrees; clicking it collapses/expands just those rows.
3. Status icons match `wt list` (run `wt list` in a shell and compare dirty/ahead/behind/integrated glyphs).
4. No path/basename line under any branch.

- [ ] **Step 4: Final commit if any fixups**

Only if Step 3 surfaced fixes. Otherwise this plan is complete.
