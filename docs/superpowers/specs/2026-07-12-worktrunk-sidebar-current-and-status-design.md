# worktrunk sidebar — current-first layout + status icons

**Status:** Approved (2026-07-12)
**Supersedes (partially):** `2026-07-06-worktrunk-sidebar-design.md` layout section
**Distribution:** Same file — `src/worktrunk-sidebar.tsx` (TUI plugin), `src/sidebar.ts`, `src/parse.ts`

## Goal

Reshape the sidebar so the **current** worktree is always visible at the top, with all other worktrees grouped under a separately collapsible "Other" section. Add per-row **status icons** (dirty, ahead, behind, integrated) derived from `wt list --format json` fields that we already fetch on every refresh.

## Non-goals

- Interactive rows (click-to-switch). Sidebar stays display-only.
- CI / LLM summary status (`--full`). Local + upstream-sync state only.
- Changing refresh cadence, error handling, or the `wt list` invocation flags.

## Layout

```
┌─ Worktrees ─────────────────┐
│ ● main  ↑3 ✓        ← current (always visible, accent, bold)
│                              │
│ ▼ Other (1)            ← collapsible, click toggles
│   ○ testing123  ✓ ↓15       │
└──────────────────────────────┘
```

- **Current row**: rendered at the top, always visible — independent of the "Other" collapse state. Accent color, bold branch, `●` marker.
- **Other section**: header `▶/▼ Other (N)` with count; toggles visibility of all non-current worktrees. Each row uses `○` marker, muted color.
- **No path line**: the previous `basename` line under each branch is removed (found confusing). A row is branch + status only.

## Status icons

Derived from raw `wt list` fields, combined into one right-aligned, muted string per row. Icons omitted when not applicable.

| Icon | Meaning | Source field |
|------|---------|--------------|
| `*` | dirty working tree | `working_tree.modified \|\| staged \|\| untracked \|\| renamed \|\| deleted` |
| `↑N` | ahead of base | `remote.ahead` (when `is_main`) or `main.ahead` (feature) |
| `↓N` | behind base | `remote.behind` (when `is_main`) or `main.behind` (feature) |
| `✓` | integrated into main | `main_state === "integrated"` |

Order: dirty → ahead → behind → integrated. A clean, in-sync worktree shows no status string. Current worktree shows the same icons (status is status).

## Code changes

```
src/parse.ts              — extend ListEntry + parseListResult with status fields
src/sidebar.ts            — extend SidebarRow; add statusIcon() + partition helpers
src/sidebar.test.ts       — tests for status derivation and current/others split
src/worktrunk-sidebar.tsx — restructure render: current-on-top + collapsible Other
```

### `parse.ts`

Extend `ListEntry` (additive — existing fields stay):

```ts
export type ListEntry = {
  branch: string;
  path: string;
  isMain: boolean;
  isCurrent: boolean;      // from is_current
  isPrevious: boolean;     // from is_previous
  mainState?: string;      // from main_state ("is_main" | "integrated" | …)
  ahead: number;           // remote.ahead (main) or main.ahead (feature)
  behind: number;          // remote.behind (main) or main.behind (feature)
  dirty: boolean;          // any of working_tree.{modified,staged,untracked,renamed,deleted}
};
```

`parseListResult` maps snake_case → camelCase and selects ahead/behind from `remote` (main worktree) or `main` (feature worktree) depending on which object is present.

### `sidebar.ts`

Extend `SidebarRow` — drop `basename` (no longer rendered), add `status: string` (precomputed) and `isCurrent`/`isPrevious`:

```ts
export type SidebarRow = {
  branch: string;
  path: string;            // kept for partitioning/debug; not rendered
  status: string;          // e.g. "* ↑3 ✓" or "" when clean/in-sync
  isMain: boolean;
  isCurrent: boolean;
  isPrevious: boolean;
  active: boolean;         // session directory matches this worktree
};
```

Two pure helpers (both unit-tested):

- `statusIcon(entry): string` — turns a `SidebarRow`'s raw fields into the icon string.
- `partitionRows(rows): { current: SidebarRow | null; others: SidebarRow[] }` — splits for the renderer. Uses `active` (session directory match) as the current-worktree signal, falling back to `isCurrent`.

### `worktrunk-sidebar.tsx`

The slot render:
1. `partitionRows(rows())` → `{ current, others }`.
2. If `current` exists, render it at top, always (accent, bold, `●`, status string right-aligned, muted).
3. Render "Other" header row (clickable toggle, `▶/▼`, count = `others.length`). When `others.length === 0`, the header is hidden entirely.
4. When not collapsed, render each `other` row (muted, `○`, branch, status string).

The `collapsed` signal now governs only the "Other" section. `activeRow`/`collapsed && activeRow` fallback logic is removed (current is always shown).

## Tests (`sidebar.test.ts`)

- `statusIcon`: clean+in-sync → `""`; dirty → `*`; ahead → `↑N`; behind → `↓N`; integrated → `✓`; combined dirty+ahead+integrated → `* ↑N ✓`.
- `partitionRows`: current selected by `active`; when none active, falls back to `isCurrent`; `others` excludes the current in insertion order.
- Existing `formatSidebarRows` tests updated for the new shape (no `basename`, added `status`/`isCurrent`/`isPrevious`).

## Verification

- `bun test` — all unit tests pass.
- `bun build src/worktrunk-sidebar.tsx --no-bundle --outfile /dev/null` — compiles.
- Restart opencode, confirm current worktree always visible + others collapsible + icons match `wt list` table.
