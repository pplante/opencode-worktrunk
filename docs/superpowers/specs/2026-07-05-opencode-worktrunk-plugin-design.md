# opencode-worktrunk plugin — design

**Status:** Approved (2026-07-05)
**Distribution:** Personal global plugin — `~/.config/opencode/plugins/worktrunk-wt.ts`

## Goal

An opencode plugin that lets agents manage git worktrees through the
[worktrunk](https://worktrunk.dev) CLI (`wt`). When an agent creates or switches
to a worktree, the **opencode session's working directory is rebound to that
worktree**, so every tool (`read`/`edit`/`bash`/`glob`/`grep`/`lsp`) operates
from the worktree root and in-worktree file edits do not trigger
`external_directory` permission prompts.

## Non-goals

- Publishing to npm (personal global plugin only).
- Managing the project's `.config/wt.toml` hooks (the user owns that).
- Registering an opencode `experimental_workspace` adaptor — the session-cwd
  rebind is handled by a stable SDK RPC (see below), so the experimental
  adaptor is unnecessary.
- TUI / workspace-UI integration.

## Core mechanism

Each opencode session carries its own `directory` field (the session cwd). The
opencode SDK exposes:

```
client.session.update({ path: { id: sessionID }, query: { directory: worktreePath } })
```

to rebind it. After the rebind, opencode treats the worktree as the session's
project root. Edits inside it are internal → no `external_directory` prompt.
This RPC is part of the published `@opencode-ai/sdk` types
(`SessionUpdateData.query.directory`) and is confirmed by the `Session`
type carrying a top-level `directory: string` field.

Source of truth for this claim:
`~/.opencode/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`
(`Session` at L465, `SessionCreateData` at L1808, `SessionUpdateData` at L1913).

`session.create` also accepts `query.directory`, but this plugin does not spawn
new sessions — it rebinds the running session in place.

## Tool surface

Five custom tools registered via the plugin `tool:` hook. Each shells out to
`wt` using `--format json` (parseable output), `--no-cd` (the plugin owns cwd
via `session.update`, not a parent-shell `cd`), and `-y` (non-interactive; skip
wt's own approval prompts). Project hooks (`pre-start`, `pre-merge`, …) still
run unless the agent passes `noHooks`.

### `worktrunk_create`
**Args:** `branch: string`, `base?: string`, `noHooks?: boolean`
**Behavior:**
1. `wt switch --create <branch> [--base <base>] --no-cd --format json -y [--no-hooks]`
2. Parse `worktree_path` (and `branch`) from the JSON result.
3. `client.session.update({ path:{id: sessionID}, query:{directory: worktreePath} })`.
4. Store `{worktreePath, branch}` in the per-session state map.
5. Return `{worktreePath, branch}` to the agent.

**Errors:** branch already exists; base not found; path occupied (suggest
`wt switch` to the existing worktree or `worktrunk_remove`); hooks need approval
(see "Hook approvals").

### `worktrunk_switch`
**Args:** `branch: string`, `noHooks?: boolean`
**Behavior:**
1. `wt switch <branch> --no-cd --format json -y [--no-hooks]`
   - `wt switch` creates a worktree for an existing local branch if one doesn't
     exist yet, and creates a tracking branch for a remote-only branch. It does
     NOT create new branches — that's `worktrunk_create`.
2–5. Same as `worktrunk_create` (parse, rebind, store, return).

**Errors:** branch doesn't exist (suggest `worktrunk_create`); no worktree
available for branch; hooks need approval.

### `worktrunk_merge`
**Args:** `target?: string` (defaults to the default branch), `noRemove?: boolean`,
`noSquash?: boolean`, `noHooks?: boolean`
**Behavior:**
1. `wt merge [target] [--no-remove] [--no-squash] --format json -y [--no-hooks]`
   - `wt merge` defaults to squash & rebase, fast-forwards the target branch,
     **removes the current worktree**, and **switches back to the target's
     worktree**. The plugin must follow that switch.
2. Parse the post-merge worktree path from the JSON result (field TBD during
   implementation — likely `worktree_path` for the target; fall back to
   `wt list --format json` to resolve the active one if missing).
3. `client.session.update({ path:{id: sessionID}, query:{directory: postMergePath} })`
   to rebind the session away from the now-removed worktree.
4. Update the state map to the post-merge `{worktreePath, branch}`.
5. Return `{mergedTo: target, worktreePath: postMergePath, removedBranch}`.

**Errors:** pre-merge hook failure (propagate wt's output); merge conflict;
worktree has uncommitted changes that can't be staged; target doesn't exist;
hooks need approval.

### `worktrunk_list`
**Args:** none
**Behavior:**
1. `wt list --format json -y`
2. Return the array of worktrees (branch, path, HEAD) and mark the one whose
   `path` equals the current `session.directory` as `active: true`.

**Errors:** not a worktree repo; hooks need approval.

### `worktrunk_remove`
**Args:** `branch: string`, `noHooks?: boolean`
**Behavior:**
1. Refuse if the branch's worktree is the active one (compare its path to
   `session.directory`). Tell the agent to `worktrunk_switch` away first.
2. Otherwise: `wt remove <branch> -y [--no-hooks]`.
3. Return `{removed: branch}`.

**Errors:** active worktree (refuse); branch doesn't exist; pre-remove hook
failure; hooks need approval.

## Permissions

Two layers:

1. **Directory rebind** — once `session.directory` is the worktree root, edits
   inside it are internal to the project; opencode does not prompt for
   `external_directory`.
2. **`permission.ask` hook (belt-and-suspenders)** — the plugin keeps the
   active worktree path per session and auto-allows the file-bearing tools
   (`read`, `edit`, `glob`, `grep`, `list`) when their target path falls under
   that worktree path. `bash` doesn't need handling — after the rebind,
   `$PWD`/`cwd` in `shell.env` is already the worktree root. Anything outside
   the worktree still asks normally. This covers the edge case where opencode
   still classifies the worktree as external due to project-detection
   differences.

The plugin never auto-allows paths outside the active worktree.

## State

- In-memory `Map<sessionID, {worktreePath: string, branch: string}>`, populated
  by `create`/`switch`/`merge` and cleared by `session.deleted` event.
- Concurrency model: per-session active worktree. Multiple parallel opencode
  sessions can each be in different worktrees; the map is keyed by `sessionID`.
  No cross-session coordination is needed because `wt` manages worktree state
  on disk and the plugin only mirrors the per-session "active" pointer.

## Hook approvals (security)

Worktrunk never runs a project's hooks (`.config/wt.toml`) until the user has
approved them. In a non-interactive tool call, wt errors:

> Cannot prompt for approval in non-interactive environment

Per the worktrunk skill's guidance, approving a project's hooks is a **security
decision that belongs to the user, not the agent.** The plugin:

- Surfaces the error and the failing command to the agent.
- Tells the agent to instruct the user to run `wt config approvals add` once
  per project (the approval persists in `~/.config/worktrunk/approvals.toml`).
- **Never** passes `--yes` on the user's behalf to silence the approval gate.
- Offers the agent `noHooks: true` as an escape hatch for operations where hooks
  aren't needed (with a warning that `pre-merge`/`pre-start` validations are
  skipped).

## `wt` invocation details

- Working directory for `wt` calls: the **project root** (the original launch
  directory, not the rebound session directory) so `wt` resolves the repo
  consistently. Concretely, `wt -C <projectRoot> switch ...` is used, where
  `projectRoot` is `project.worktree` from the plugin input, captured at init.
  (Rationale: once we rebind `session.directory` to a worktree, a bare
  `wt switch` would operate on the *new* worktree's branch context, which
  could confuse branch resolution. Pinning `-C <projectRoot>` keeps `wt`
  rooted at the main worktree.)
- `--no-cd` on `switch` so `wt` doesn't emit a shell-integration cd script the
  plugin can't consume; the plugin performs the cd via `session.update`.
- `-y` because tool calls are non-interactive.
- `--format json` for all calls whose output the plugin parses; stderr is still
  surfaced to the agent on failure.

## Error handling

- wt non-zero exit: propagate the JSON error if present, else the stderr text.
- JSON parse failure: fall back to raw stdout + a marker that parsing failed.
- `session.update` failure: surface to the agent; the worktree exists on disk
  but the session cwd wasn't rebound — the agent should inform the user, who
  may need to restart opencode.
- Network / SDK errors from `client.*`: surface message; no silent retry.

## Open questions for implementation

1. **JSON output shape** — exact field names for `wt switch --format json` and
   `wt merge --format json` (e.g. `worktree_path`, `branch`, `target`). Resolve
   by running the commands in a scratch repo during implementation; the spec
   only assumes they exist (confirmed by `wt switch --help`:
   "JSON prints structured result to stdout. Designed for tool integration.").
2. **`wt -C <root>` from a rebound session** — confirm `wt -C` resolves the
   repo correctly regardless of session cwd; if `wt` is CWD-sensitive in a way
   that breaks this, fall back to `cd <projectRoot> && wt ...` via `$` shell.
3. **Post-merge path resolution** — confirm whether `wt merge --format json`
   includes the post-merge active worktree path. If not, call
   `wt list --format json` to resolve it.

## Verification

Manual, end-to-end in a scratch repo:

1. Install plugin → restart opencode.
2. `worktrunk_create branch=feat-a` → session cwd is the feat-a worktree;
   `read`/`edit` there need no permission prompt; `bash` `pwd` shows the
   worktree.
3. `worktrunk_list` → feat-a marked active; main worktree present.
4. `worktrunk_create branch=feat-b base=feat-a` → session in feat-b; create
   a file; `bash` `git status` shows it on feat-b.
5. `worktrunk_switch branch=feat-a` → session back in feat-a; the feat-b file
   is absent (different worktree).
6. `worktrunk_merge` → feat-a merges into default branch, worktree removed,
   session rebound to default worktree; `bash` `pwd` confirms.
7. **`worktrunk_remove` refusal on active** — call `worktrunk_remove` on the
   currently active worktree (the default branch after step 6); it must refuse
   and tell the agent to switch away first.
8. **`worktrunk_remove` success on inactive** — call `worktrunk_remove` on a
   clean leftover worktree (create `feat-c`, switch to main, then remove
   `feat-c`); it succeeds and the worktree directory is gone.
9. Hook approval flow: with an unapproved `.config/wt.toml`, a `worktrunk_*`
   call surfaces the approval error and the `wt config approvals add`
   instruction; never uses `--yes`.

## File layout

```
~/.config/opencode/plugins/worktrunk-wt.ts   # the plugin (single file)
```

Repo (this repo, `opencode-wt`) holds only design + plan docs:

```
docs/superpowers/specs/2026-07-05-opencode-worktrunk-plugin-design.md   # this file
docs/implementation-plans/opencode-worktrunk-plugin.md                  # (next step)
```
