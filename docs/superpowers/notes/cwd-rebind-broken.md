# cwd-rebind broken on opencode 1.17.13/1.17.14

**Date discovered:** 2026-07-06
**Affected versions:** opencode 1.17.13, 1.17.14 (and likely 1.17.x)
**Affected code:** `src/worktrunk-wt.ts` — `rebindDirectory()` is a silent no-op.

## Symptom

`worktrunk_create` / `worktrunk_switch` / `worktrunk_merge` return success messages saying
"Session working directory is now <worktree-path>", but the bash tool's `$PWD` and
`session.directory` (queried via `GET /session/{id}`) remain the original project root.
The worktree is created on disk, but the session never moves into it.

## Root cause

opencode 1.17.x has no working server-side API to rebind a *running* session's cwd.

`SessionUpdateData.query.directory` is declared as settable in the SDK types
(`~/.opencode/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:1913-1924`),
and the plugin calls:

```ts
await client.session.update({
  path: { id: sessionID },
  query: { directory },
});
```

But `PATCH /session/{id}` silently ignores the `directory` field. Confirmed via curl:

```
GET /session/{id}                       → directory: /main/path
PATCH /session/{id}?directory=<wt>      → 200, returned directory unchanged
PATCH /session/{id} body.directory=...  → 200, returned directory unchanged
PATCH with x-opencode-directory header  → 200, returned directory unchanged
```

Title updates on the same PATCH work fine, proving the endpoint is reachable —
only `directory` is dropped server-side.

## What also doesn't work

- **`x-opencode-directory` header on PATCH** — ignored. The header is a per-request
  routing hint the v2 client rewrites into `?directory=` on GETs; it is not a state
  mutation mechanism.
- **`x-opencode-directory` header on `POST /session/{id}/shell`** — the response's
  `info.path.cwd` field remains the original project root, not the worktree.
- **`PUT /session/{id}`** — returns 200 but doesn't change directory either.
- Schema search of `@opencode-ai/sdk` v1 and v2 for `setDirectory|chdir|setCwd|
  changeDirectory|rebind` returned no matches. There is no alternative named API.

## Implications

1. The worktrunk plugin's core mechanism — rebind session.directory after `wt switch` —
   has been a silent no-op since the upgrade to 1.17.x. Tools report success but the
   bash tool (and read/edit/glob/grep) operate on the original project root, not the
   worktree. Any in-worktree edit may actually be editing the main checkout.
2. The `permission.ask` auto-allow hook may also be matching against a worktree path
   that the session was never actually moved into — needs re-verification.
3. The sidebar feature (designed separately in `docs/superpowers/specs/2026-07-06-
   worktrunk-sidebar-design.md`) is unaffected at the rendering level — it reads
   `wt list` independently. But its end-to-end verification ("agent switches →
   sidebar updates") depends on the rebind working.

## Options

- **A. File upstream issue with opencode.** The SDK types advertise `directory` as
  settable; the server silently drops it. Either the types are wrong or the server
  has a bug. Lowest-effort, justest outcome.
- **B. Pin opencode to a version where this worked.** Requires bisecting 1.16.x →
  1.17.x to find the regression. Unknown effort.
- **C. Rewrite worktrunk-wt to spawn a new session per worktree.** Heavy. Changes
  the UX (every switch abandons message history). Probably the wrong direction.
- **D. Drop the SDK rebind; rely on `wt switch`'s own shell integration.** Only
  works if opencode's bash tool runs in a parent shell where `wt` printed a `cd`
  script. Unlikely — the plugin uses `--no-cd` deliberately because it can't
  consume that script.

## Recommendation

**A first, B as fallback.** Don't burn more time on C/D until upstream confirms
whether `directory` on `PATCH /session/{id}` is meant to work in 1.17.x.
