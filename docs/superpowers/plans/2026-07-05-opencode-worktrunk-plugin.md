# opencode-worktrunk Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal-global opencode plugin that lets agents manage git worktrees via the worktrunk CLI (`wt`), with the session's working directory rebound to the active worktree after each create/switch/merge.

**Architecture:** Pure helpers (arg-building, JSON parsing, path comparison, session state) extracted into testable modules. A thin plugin entry file ties them to opencode's `tool:` hook system. Session cwd is rebound via the stable SDK RPC `client.session.update({ query: { directory } })` — no experimental APIs. In-worktree edits become internal to the project (no permission prompts); a `permission.ask` hook is belt-and-suspenders for any edge case.

**Tech Stack:** TypeScript, Bun (test runner + runtime), `@opencode-ai/plugin` SDK, worktrunk CLI (`wt` v0.65.0+).

## Global Constraints

- `wt` v0.65.0+ installed at `/opt/homebrew/bin/wt`. Verify with `wt --version`.
- opencode 1.17.13 installed. Plugin SDK package: `@opencode-ai/plugin` (pinned `1.15.13` in `~/.config/opencode/package.json`).
- Plugin file lives at `~/.config/opencode/plugins/worktrunk-wt.ts` (auto-loaded by opencode; restart opencode after install).
- All `wt` calls use: `wt -C <projectRoot>` (pins working directory to the stable project root), `--no-cd` (switch only — plugin owns cwd via `session.update`), `--format json` (parseable output on stdout), `-y` (non-interactive).
- JSON output goes to stdout; human status text goes to stderr. `$.quiet().text()` captures clean JSON.
- `wt merge` JSON has no post-merge worktree path — call `wt list --format json` to resolve the target branch's worktree path.
- Never pass `--yes` on the user's behalf to silence hook approvals. If hooks need approval, surface the error and tell the user to run `wt config approvals add`.
- No code comments unless explicitly requested.
- After saving any opencode config/plugin change, remind the user to restart opencode.

## File Structure

```
/Users/phil/Projects/opencode-wt/
├── package.json                 # bun project, @opencode-ai/plugin dep
├── src/
│   ├── paths.ts                 # isUnderPath(child, parent), resolvePath(p)
│   ├── paths.test.ts
│   ├── parse.ts                 # parseSwitchResult, parseListResult, parseMergeResult, parseRemoveResult
│   ├── parse.test.ts
│   ├── args.ts                  # buildSwitchArgs, buildMergeArgs, buildListArgs, buildRemoveArgs
│   ├── args.test.ts
│   ├── state.ts                 # createState(): per-session state map
│   ├── state.test.ts
│   └── worktrunk-wt.ts          # plugin entry — imports all above, registers 5 tools + 3 hooks
└── docs/                        # design spec + this plan
```

**Installation (symlink):**
```bash
ln -sf "$(pwd)/src/worktrunk-wt.ts" ~/.config/opencode/plugins/worktrunk-wt.ts
```
Bun resolves imports from the symlink target's real path (`<repo>/src/`), so the repo's `node_modules/` must contain `@opencode-ai/plugin`. If `bun install` can't find the package on npm, fallback: copy the file instead of symlinking (`cp src/worktrunk-wt.ts ~/.config/opencode/plugins/`), which resolves from `~/.config/opencode/node_modules/`.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`

**Interfaces:**
- Produces: a `package.json` with `@opencode-ai/plugin` dependency so `import { tool }` resolves at runtime via the symlink.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "opencode-worktrunk",
  "private": true,
  "type": "module",
  "dependencies": {
    "@opencode-ai/plugin": "1.15.13"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `bun install`
Expected: `node_modules/` created with `@opencode-ai/plugin` and transitive deps.

- [ ] **Step 3: Verify the plugin SDK resolves**

Run: `bun -e "import { tool } from '@opencode-ai/plugin'; console.log(typeof tool)"`
Expected: prints `function` (or `object`). If it throws `Cannot find module`, the package isn't on npm at that version — try `"latest"` instead, or fall back to the copy-install strategy (no symlink).

- [ ] **Step 4: Create src/ directory**

Run: `mkdir -p src`
Expected: `src/` exists.

- [ ] **Step 5: Commit**

```bash
git add package.json && git commit -m "chore: scaffold bun project with @opencode-ai/plugin dep"
```

---

### Task 2: paths.ts — Path Utilities

**Files:**
- Create: `src/paths.ts`
- Test: `src/paths.test.ts`

**Interfaces:**
- Produces: `isUnderPath(childPath, parentPath): boolean` — true if `childPath` is the same as or inside `parentPath`. `resolvePath(p): string` — resolves symlinks (handles `/tmp` vs `/private/tmp` on macOS).

- [ ] **Step 1: Write the failing test**

```typescript
import { test, expect } from "bun:test";
import { isUnderPath } from "./paths";

test("child is under parent", () => {
  expect(isUnderPath("/a/b/c", "/a/b")).toBe(true);
});

test("same path is under itself", () => {
  expect(isUnderPath("/a/b", "/a/b")).toBe(true);
});

test("sibling is not under parent", () => {
  expect(isUnderPath("/a/bd", "/a/b")).toBe(false);
});

test("parent is not under child", () => {
  expect(isUnderPath("/a/b", "/a/b/c")).toBe(false);
});

test("unrelated path", () => {
  expect(isUnderPath("/x/y", "/a/b")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/paths.test.ts`
Expected: FAIL — `isUnderPath` is not defined (module not found).

- [ ] **Step 3: Write minimal implementation**

```typescript
import path from "path";
import { realpathSync } from "fs";

export function isUnderPath(childPath: string, parentPath: string): boolean {
  const rel = path.relative(parentPath, childPath);
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function resolvePath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/paths.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/paths.ts src/paths.test.ts
git commit -m "feat: add isUnderPath path comparison utility"
```

---

### Task 3: parse.ts — wt JSON Parsers

**Files:**
- Create: `src/parse.ts`
- Test: `src/parse.test.ts`

**Interfaces:**
- Produces: `parseSwitchResult(stdout): SwitchResult`, `parseListResult(stdout): ListEntry[]`, `parseMergeResult(stdout): MergeResult`, `parseRemoveResult(stdout): RemoveEntry[]`. Types are exported for downstream use.

**wt JSON shapes (confirmed by probing `wt --format json`):**

`wt switch --format json` stdout:
```json
{"action":"created","branch":"feat","path":"/abs/path","created_branch":true,"base_branch":"main"}
```

`wt list --format json` stdout (array, pretty-printed):
```json
[{"branch":"main","path":"/abs","is_main":true,"is_current":true},...]
```

`wt merge --format json` stdout:
```json
{"branch":"feat","committed":false,"rebased":false,"removed":true,"squashed":false,"target":"main"}
```

`wt remove --format json` stdout (array):
```json
[{"branch":"del-me","branch_deleted":true,"kind":"worktree","path":"/abs"}]
```

- [ ] **Step 1: Write the failing test**

```typescript
import { test, expect } from "bun:test";
import {
  parseSwitchResult,
  parseListResult,
  parseMergeResult,
  parseRemoveResult,
} from "./parse";

test("parseSwitchResult - created", () => {
  const json =
    '{"action":"created","branch":"feat","path":"/tmp/wt.feat","created_branch":true,"base_branch":"main"}';
  const result = parseSwitchResult(json);
  expect(result).toEqual({
    action: "created",
    branch: "feat",
    path: "/tmp/wt.feat",
    createdBranch: true,
    baseBranch: "main",
  });
});

test("parseSwitchResult - already_at (no created_branch/base_branch)", () => {
  const json =
    '{"action":"already_at","branch":"main","path":"/tmp/wt"}';
  const result = parseSwitchResult(json);
  expect(result.action).toBe("already_at");
  expect(result.branch).toBe("main");
  expect(result.path).toBe("/tmp/wt");
  expect(result.createdBranch).toBe(false);
  expect(result.baseBranch).toBeUndefined();
});

test("parseListResult", () => {
  const json = JSON.stringify([
    { branch: "main", path: "/tmp/wt", is_main: true, is_current: true },
    { branch: "feat", path: "/tmp/wt.feat", is_main: false, is_current: false },
  ]);
  const result = parseListResult(json);
  expect(result).toHaveLength(2);
  expect(result[0]).toEqual({
    branch: "main",
    path: "/tmp/wt",
    isMain: true,
  });
  expect(result[1].branch).toBe("feat");
  expect(result[1].isMain).toBe(false);
});

test("parseMergeResult", () => {
  const json =
    '{"branch":"feat","committed":false,"rebased":false,"removed":true,"squashed":false,"target":"main"}';
  const result = parseMergeResult(json);
  expect(result).toEqual({
    branch: "feat",
    committed: false,
    rebased: false,
    removed: true,
    squashed: false,
    target: "main",
  });
});

test("parseRemoveResult", () => {
  const json = JSON.stringify([
    {
      branch: "del-me",
      branch_deleted: true,
      kind: "worktree",
      path: "/tmp/wt.del-me",
    },
  ]);
  const result = parseRemoveResult(json);
  expect(result).toHaveLength(1);
  expect(result[0]).toEqual({
    branch: "del-me",
    branchDeleted: true,
    kind: "worktree",
    path: "/tmp/wt.del-me",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
export type SwitchResult = {
  action: string;
  branch: string;
  path: string;
  createdBranch: boolean;
  baseBranch?: string;
};

export type ListEntry = {
  branch: string;
  path: string;
  isMain: boolean;
};

export type MergeResult = {
  branch: string;
  committed: boolean;
  rebased: boolean;
  removed: boolean;
  squashed: boolean;
  target: string;
};

export type RemoveEntry = {
  branch: string;
  branchDeleted: boolean;
  kind: string;
  path: string;
};

export function parseSwitchResult(stdout: string): SwitchResult {
  const raw = JSON.parse(stdout) as {
    action: string;
    branch: string;
    path: string;
    created_branch?: boolean;
    base_branch?: string;
  };
  return {
    action: raw.action,
    branch: raw.branch,
    path: raw.path,
    createdBranch: raw.created_branch ?? false,
    baseBranch: raw.base_branch,
  };
}

export function parseListResult(stdout: string): ListEntry[] {
  const raw = JSON.parse(stdout) as Array<{
    branch: string;
    path: string;
    is_main?: boolean;
  }>;
  return raw.map((w) => ({
    branch: w.branch,
    path: w.path,
    isMain: w.is_main ?? false,
  }));
}

export function parseMergeResult(stdout: string): MergeResult {
  const raw = JSON.parse(stdout) as {
    branch: string;
    committed: boolean;
    rebased: boolean;
    removed: boolean;
    squashed: boolean;
    target: string;
  };
  return {
    branch: raw.branch,
    committed: raw.committed,
    rebased: raw.rebased,
    removed: raw.removed,
    squashed: raw.squashed,
    target: raw.target,
  };
}

export function parseRemoveResult(stdout: string): RemoveEntry[] {
  const raw = JSON.parse(stdout) as Array<{
    branch: string;
    branch_deleted?: boolean;
    kind: string;
    path: string;
  }>;
  return raw.map((w) => ({
    branch: w.branch,
    branchDeleted: w.branch_deleted ?? false,
    kind: w.kind,
    path: w.path,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/parse.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/parse.ts src/parse.test.ts
git commit -m "feat: add wt JSON output parsers"
```

---

### Task 4: args.ts — wt CLI Argument Builders

**Files:**
- Create: `src/args.ts`
- Test: `src/args.test.ts`

**Interfaces:**
- Produces: `buildSwitchArgs`, `buildMergeArgs`, `buildListArgs`, `buildRemoveArgs`. Each takes a typed input and returns `string[]` (the args after `wt -C <root>`, injected into Bun's `$` template).
- Consumes: nothing (pure functions).

- [ ] **Step 1: Write the failing test**

```typescript
import { test, expect } from "bun:test";
import {
  buildSwitchArgs,
  buildMergeArgs,
  buildListArgs,
  buildRemoveArgs,
} from "./args";

test("buildSwitchArgs - create new branch", () => {
  expect(buildSwitchArgs({ branch: "feat", create: true })).toEqual([
    "switch",
    "--create",
    "--no-cd",
    "--format",
    "json",
    "-y",
    "feat",
  ]);
});

test("buildSwitchArgs - create with base and noHooks", () => {
  expect(
    buildSwitchArgs({
      branch: "feat",
      create: true,
      base: "develop",
      noHooks: true,
    })
  ).toEqual([
    "switch",
    "--create",
    "--base",
    "develop",
    "--no-hooks",
    "--no-cd",
    "--format",
    "json",
    "-y",
    "feat",
  ]);
});

test("buildSwitchArgs - switch to existing", () => {
  expect(buildSwitchArgs({ branch: "main", create: false })).toEqual([
    "switch",
    "--no-cd",
    "--format",
    "json",
    "-y",
    "main",
  ]);
});

test("buildMergeArgs - defaults", () => {
  expect(buildMergeArgs({})).toEqual([
    "merge",
    "--format",
    "json",
    "-y",
  ]);
});

test("buildMergeArgs - all options", () => {
  expect(
    buildMergeArgs({
      target: "develop",
      noRemove: true,
      noSquash: true,
      noHooks: true,
    })
  ).toEqual([
    "merge",
    "--no-remove",
    "--no-squash",
    "--no-hooks",
    "--format",
    "json",
    "-y",
    "develop",
  ]);
});

test("buildListArgs", () => {
  expect(buildListArgs()).toEqual([
    "list",
    "--format",
    "json",
    "-y",
  ]);
});

test("buildRemoveArgs - basic", () => {
  expect(buildRemoveArgs({ branch: "feat" })).toEqual([
    "remove",
    "--format",
    "json",
    "-y",
    "--foreground",
    "feat",
  ]);
});

test("buildRemoveArgs - with noHooks", () => {
  expect(buildRemoveArgs({ branch: "feat", noHooks: true })).toEqual([
    "remove",
    "--no-hooks",
    "--format",
    "json",
    "-y",
    "--foreground",
    "feat",
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/args.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
export type SwitchArgsInput = {
  branch: string;
  create: boolean;
  base?: string;
  noHooks?: boolean;
};

export type MergeArgsInput = {
  target?: string;
  noRemove?: boolean;
  noSquash?: boolean;
  noHooks?: boolean;
};

export type RemoveArgsInput = {
  branch: string;
  noHooks?: boolean;
};

export function buildSwitchArgs(input: SwitchArgsInput): string[] {
  const args = ["switch"];
  if (input.create) args.push("--create");
  if (input.base) args.push("--base", input.base);
  if (input.noHooks) args.push("--no-hooks");
  args.push("--no-cd", "--format", "json", "-y", input.branch);
  return args;
}

export function buildMergeArgs(input: MergeArgsInput): string[] {
  const args = ["merge"];
  if (input.noRemove) args.push("--no-remove");
  if (input.noSquash) args.push("--no-squash");
  if (input.noHooks) args.push("--no-hooks");
  args.push("--format", "json", "-y");
  if (input.target) args.push(input.target);
  return args;
}

export function buildListArgs(): string[] {
  return ["list", "--format", "json", "-y"];
}

export function buildRemoveArgs(input: RemoveArgsInput): string[] {
  const args = ["remove"];
  if (input.noHooks) args.push("--no-hooks");
  args.push("--format", "json", "-y", "--foreground", input.branch);
  return args;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/args.test.ts`
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/args.ts src/args.test.ts
git commit -m "feat: add wt CLI argument builders"
```

---

### Task 5: state.ts — Per-Session State Map

**Files:**
- Create: `src/state.ts`
- Test: `src/state.test.ts`

**Interfaces:**
- Produces: `createState()` returns `{ get, set, clear }` — an in-memory `Map<sessionID, SessionEntry>`. `SessionEntry` type is `{ worktreePath: string; branch: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
import { test, expect } from "bun:test";
import { createState } from "./state";

test("set and get", () => {
  const state = createState();
  state.set("s1", { worktreePath: "/a", branch: "main" });
  expect(state.get("s1")).toEqual({ worktreePath: "/a", branch: "main" });
});

test("get returns undefined for unknown session", () => {
  const state = createState();
  expect(state.get("unknown")).toBeUndefined();
});

test("clear removes entry", () => {
  const state = createState();
  state.set("s1", { worktreePath: "/a", branch: "main" });
  state.clear("s1");
  expect(state.get("s1")).toBeUndefined();
});

test("sessions are isolated", () => {
  const state = createState();
  state.set("s1", { worktreePath: "/a", branch: "main" });
  state.set("s2", { worktreePath: "/b", branch: "feat" });
  expect(state.get("s1")?.branch).toBe("main");
  expect(state.get("s2")?.branch).toBe("feat");
  state.clear("s1");
  expect(state.get("s1")).toBeUndefined();
  expect(state.get("s2")?.branch).toBe("feat");
});

test("each createState call is independent", () => {
  const s1 = createState();
  const s2 = createState();
  s1.set("x", { worktreePath: "/a", branch: "main" });
  expect(s2.get("x")).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
export type SessionEntry = {
  worktreePath: string;
  branch: string;
};

export function createState() {
  const map = new Map<string, SessionEntry>();
  return {
    get(sessionID: string): SessionEntry | undefined {
      return map.get(sessionID);
    },
    set(sessionID: string, entry: SessionEntry): void {
      map.set(sessionID, entry);
    },
    clear(sessionID: string): void {
      map.delete(sessionID);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/state.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Run all tests together**

Run: `bun test`
Expected: PASS — all tests across paths, parse, args, state pass.

- [ ] **Step 6: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat: add per-session state map"
```

---

### Task 6: worktrunk-wt.ts — Plugin Entry (5 Tools + 3 Hooks)

**Files:**
- Create: `src/worktrunk-wt.ts`

**Interfaces:**
- Consumes: `buildSwitchArgs`/`buildMergeArgs`/`buildListArgs`/`buildRemoveArgs` from `./args`; `parseSwitchResult`/`parseListResult`/`parseMergeResult`/`parseRemoveResult` from `./parse`; `isUnderPath`/`resolvePath` from `./paths`; `createState`/`SessionEntry` from `./state`. Also `tool` and `Plugin` type from `@opencode-ai/plugin`.
- Produces: a default-exported `Plugin` function that registers 5 tools (`worktrunk_create`, `worktrunk_switch`, `worktrunk_merge`, `worktrunk_list`, `worktrunk_remove`) and 3 hooks (`permission.ask`, `shell.env`, `event`).

This is the integration layer — no unit tests. Pure helpers are tested in Tasks 2–5. This task is verified end-to-end in Task 7.

- [ ] **Step 1: Write the plugin file**

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import {
  buildSwitchArgs,
  buildMergeArgs,
  buildListArgs,
  buildRemoveArgs,
} from "./args";
import {
  parseSwitchResult,
  parseListResult,
  parseMergeResult,
  parseRemoveResult,
} from "./parse";
import { isUnderPath, resolvePath } from "./paths";
import { createState } from "./state";

export default (async ({ client, $, worktree: projectRoot }) => {
  const state = createState();

  async function runWt(args: string[]): Promise<string> {
    try {
      return await $`wt -C ${projectRoot} ${args}`.quiet().text();
    } catch (err: any) {
      const stderr = err.stderr || err.stdout || err.message || "";
      throw new Error(
        `wt ${args.join(" ")} failed (exit ${err.exitCode}): ${stderr.trim()}`
      );
    }
  }

  async function rebindDirectory(
    sessionID: string,
    directory: string
  ): Promise<void> {
    await client.session.update({
      path: { id: sessionID },
      query: { directory },
    });
  }

  async function resolveWorktreePath(branch: string): Promise<string | null> {
    const stdout = await runWt(buildListArgs());
    const list = parseListResult(stdout);
    const entry = list.find((w) => w.branch === branch);
    return entry?.path ?? null;
  }

  return {
    tool: {
      worktrunk_create: tool({
        description:
          "Create a new git worktree on a new branch using worktrunk (wt). Switches the session's working directory to the new worktree. The agent then works from that worktree without permission prompts.",
        args: {
          branch: tool
            .schema.string()
            .describe("New branch name for the worktree"),
          base: tool
            .schema.string()
            .optional()
            .describe(
              "Base branch to create from (defaults to default branch). Supports: ^, @, -, pr:{N}"
            ),
          noHooks: tool
            .schema.boolean()
            .optional()
            .describe("Skip wt project hooks (pre-start, etc.)"),
        },
        async execute(args, context) {
          const { sessionID } = context;
          const wtArgs = buildSwitchArgs({
            branch: args.branch,
            create: true,
            base: args.base ?? undefined,
            noHooks: args.noHooks ?? undefined,
          });
          const stdout = await runWt(wtArgs);
          const result = parseSwitchResult(stdout);
          await rebindDirectory(sessionID, result.path);
          state.set(sessionID, {
            worktreePath: result.path,
            branch: result.branch,
          });
          return `Created worktree for branch "${result.branch}" at ${result.path}. Session working directory is now ${result.path}.`;
        },
      }),

      worktrunk_switch: tool({
        description:
          "Switch the session to an existing git worktree using worktrunk (wt). Creates a worktree for the branch if one doesn't exist yet (but the branch must already exist). Switches the session's working directory to the worktree. Use worktrunk_create to create a new branch.",
        args: {
          branch: tool
            .schema.string()
            .describe(
              "Branch name to switch to. Supports: ^, @, -, pr:{N}"
            ),
          noHooks: tool
            .schema.boolean()
            .optional()
            .describe("Skip wt project hooks"),
        },
        async execute(args, context) {
          const { sessionID } = context;
          const wtArgs = buildSwitchArgs({
            branch: args.branch,
            create: false,
            noHooks: args.noHooks ?? undefined,
          });
          const stdout = await runWt(wtArgs);
          const result = parseSwitchResult(stdout);
          await rebindDirectory(sessionID, result.path);
          state.set(sessionID, {
            worktreePath: result.path,
            branch: result.branch,
          });
          return `Switched to worktree for branch "${result.branch}" at ${result.path}. Session working directory is now ${result.path}.`;
        },
      }),

      worktrunk_merge: tool({
        description:
          "Merge the current branch into the target branch (defaults to default branch) using worktrunk (wt). Squashes and rebases by default. Removes the current worktree after merge and switches the session to the target branch's worktree. If project hooks need approval and haven't been approved, the merge will fail — tell the user to run 'wt config approvals add'.",
        args: {
          target: tool
            .schema.string()
            .optional()
            .describe(
              "Target branch to merge into (defaults to default branch)"
            ),
          noRemove: tool
            .schema.boolean()
            .optional()
            .describe("Keep the worktree after merging"),
          noSquash: tool
            .schema.boolean()
            .optional()
            .describe("Preserve individual commits (no squash)"),
          noHooks: tool
            .schema.boolean()
            .optional()
            .describe(
              "Skip wt project hooks (pre-merge, pre-remove, etc.)"
            ),
        },
        async execute(args, context) {
          const { sessionID } = context;
          const wtArgs = buildMergeArgs({
            target: args.target ?? undefined,
            noRemove: args.noRemove ?? undefined,
            noSquash: args.noSquash ?? undefined,
            noHooks: args.noHooks ?? undefined,
          });
          const stdout = await runWt(wtArgs);
          const result = parseMergeResult(stdout);

          const targetPath = await resolveWorktreePath(result.target);
          if (!targetPath) {
            throw new Error(
              `Merge succeeded but could not find worktree for target branch "${result.target}". Run 'wt list' to check.`
            );
          }

          await rebindDirectory(sessionID, targetPath);
          state.set(sessionID, {
            worktreePath: targetPath,
            branch: result.target,
          });
          return `Merged to "${result.target}". Worktree removed: ${result.removed}. Session working directory is now ${targetPath}.`;
        },
      }),

      worktrunk_list: tool({
        description:
          "List all git worktrees in the repository using worktrunk (wt). Marks the active worktree (the one the session is currently in).",
        args: {},
        async execute(args, context) {
          const { directory } = context;
          const stdout = await runWt(buildListArgs());
          const list = parseListResult(stdout);
          const resolvedDir = resolvePath(directory);
          const result = list.map((w) => ({
            branch: w.branch,
            path: w.path,
            active: isUnderPath(resolvedDir, resolvePath(w.path)),
            isMain: w.isMain,
          }));
          return JSON.stringify(result, null, 2);
        },
      }),

      worktrunk_remove: tool({
        description:
          "Remove a git worktree and its branch (if merged) using worktrunk (wt). Cannot remove the worktree the session is currently in — switch to another worktree first.",
        args: {
          branch: tool
            .schema.string()
            .describe("Branch name of the worktree to remove"),
          noHooks: tool
            .schema.boolean()
            .optional()
            .describe("Skip wt project hooks"),
        },
        async execute(args, context) {
          const { directory, sessionID } = context;
          const listStdout = await runWt(buildListArgs());
          const list = parseListResult(listStdout);
          const target = list.find((w) => w.branch === args.branch);

          if (!target) {
            throw new Error(
              `No worktree found for branch "${args.branch}". Run 'worktrunk_list' to see available worktrees.`
            );
          }

          const resolvedDir = resolvePath(directory);
          const resolvedTarget = resolvePath(target.path);
          if (isUnderPath(resolvedDir, resolvedTarget)) {
            throw new Error(
              `Cannot remove the active worktree (branch "${args.branch}"). Use worktrunk_switch to switch to another worktree first.`
            );
          }

          const entry = state.get(sessionID);
          if (
            entry &&
            resolvePath(entry.worktreePath) === resolvedTarget
          ) {
            throw new Error(
              `Cannot remove the active worktree (branch "${args.branch}"). Use worktrunk_switch to switch to another worktree first.`
            );
          }

          const wtArgs = buildRemoveArgs({
            branch: args.branch,
            noHooks: args.noHooks ?? undefined,
          });
          const stdout = await runWt(wtArgs);
          const result = parseRemoveResult(stdout);
          return `Removed worktree for branch "${args.branch}". Branch deleted: ${result[0]?.branchDeleted ?? false}.`;
        },
      }),
    },

    "permission.ask": async (input, output) => {
      if (input.type !== "external_directory") return;
      const entry = state.get(input.sessionID);
      if (!entry) return;
      const patterns = Array.isArray(input.pattern)
        ? input.pattern
        : input.pattern
        ? [input.pattern]
        : [];
      if (patterns.length === 0) return;
      const wtPath = resolvePath(entry.worktreePath);
      const allUnder = patterns.every((p) => {
        if (typeof p !== "string") return false;
        const clean = p.replace(/\/\*+$/, "").replace(/\/$/, "");
        return isUnderPath(resolvePath(clean), wtPath);
      });
      if (allUnder) output.status = "allow";
    },

    "shell.env": async (input, output) => {
      const entry = state.get(input.sessionID ?? "");
      if (entry) {
        output.env.PWD = entry.worktreePath;
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const sessionID = (event as any).properties?.info?.id;
        if (typeof sessionID === "string") {
          state.clear(sessionID);
        }
      }
    },
  };
}) satisfies Plugin;
```

- [ ] **Step 2: Verify it type-checks**

Run: `bunx tsc --noEmit src/worktrunk-wt.ts 2>&1 | head -20` (if tsc available). Otherwise: `bun build src/worktrunk-wt.ts --no-bundle --outfile /dev/null`
Expected: no errors. If `tool` import fails, verify `@opencode-ai/plugin` is installed (`bun install`).

- [ ] **Step 3: Run all unit tests (should still pass)**

Run: `bun test`
Expected: PASS — all pure-helper tests pass (plugin entry isn't loaded by tests).

- [ ] **Step 4: Commit**

```bash
git add src/worktrunk-wt.ts
git commit -m "feat: add worktrunk-wt plugin entry with 5 tools and 3 hooks"
```

---

### Task 7: Install + End-to-End Verification

**Files:**
- No new files. Installs the plugin via symlink and verifies manually.

- [ ] **Step 1: Install the plugin via symlink**

Run:
```bash
cd /Users/phil/Projects/opencode-wt
ln -sf "$(pwd)/src/worktrunk-wt.ts" ~/.config/opencode/plugins/worktrunk-wt.ts
ls -la ~/.config/opencode/plugins/worktrunk-wt.ts
```
Expected: symlink points to `/Users/phil/Projects/opencode-wt/src/worktrunk-wt.ts`.

- [ ] **Step 2: Tell the user to restart opencode**

opencode loads plugins once at startup. The running session won't see the new plugin until restarted.

- [ ] **Step 3: Verify in a scratch repo**

In a new opencode session in a test git repo:

1. Ask the agent to call `worktrunk_create` with `branch=feat-a`.
   - Expected: output says "Created worktree for branch 'feat-a' at <path>".
   - Verify: `bash` `pwd` shows the worktree path.
   - Verify: `read`/`edit` in the worktree don't prompt for permission.

2. Ask the agent to call `worktrunk_list`.
   - Expected: JSON array; `feat-a` has `active: true`; `main` has `isMain: true`.

3. Ask the agent to call `worktrunk_create` with `branch=feat-b, base=feat-a`.
   - Expected: session switches to feat-b worktree.

4. Ask the agent to call `worktrunk_switch` with `branch=feat-a`.
   - Expected: session back in feat-a worktree.

5. Ask the agent to make a commit on feat-a, then call `worktrunk_merge`.
   - Expected: "Merged to 'main'". Session rebound to main worktree. `bash` `pwd` confirms.

6. Ask the agent to call `worktrunk_remove` on the active worktree (main).
   - Expected: error — "Cannot remove the active worktree."

7. Ask the agent to call `worktrunk_remove` on a clean leftover worktree (create `feat-c`, switch to main, remove `feat-c`).
   - Expected: "Removed worktree for branch 'feat-c'."

8. Hook approval flow: add an unapproved hook to `.config/wt.toml` (e.g., `pre-start = "echo hello"`), then call `worktrunk_create`.
   - Expected: error mentioning "Cannot prompt for approval". The agent should tell the user to run `wt config approvals add`. The plugin must NOT pass `--yes` automatically.

- [ ] **Step 4: Commit verification notes**

```bash
git commit --allow-empty -m "chore: verify worktrunk-wt plugin end-to-end"
```

---

## Notes for the Implementer

- **`wt -C <projectRoot>`**: The `worktree` field from `PluginInput` is the stable git worktree root (the main worktree where opencode was launched). Pinning `wt -C` to this ensures consistent repo resolution even after the session directory is rebound to a different worktree.

- **Symlink path resolution**: Bun follows symlinks and resolves imports from the real path. So `import { tool } from "@opencode-ai/plugin"` resolves from `<repo>/node_modules/`, not `~/.config/opencode/node_modules/`. The repo MUST have `@opencode-ai/plugin` installed (`bun install`).

- **Session directory rebind**: `client.session.update({ path: { id: sessionID }, query: { directory: newPath } })` is the stable SDK RPC that changes the session's `directory` field. After this call, subsequent tool executions receive the new directory in `context.directory`. This is confirmed by the `SessionUpdateData` type in `@opencode-ai/sdk` (`types.gen.d.ts:1913`).

- **`shell.env` hook**: Sets `PWD` to the active worktree path as a safety net. After `session.update`, the bash tool's cwd should already be the worktree. But if it isn't (e.g., opencode doesn't propagate the rebind to the shell cwd), this hook ensures `$PWD` is correct. Verify during E2E testing whether this hook is actually needed — if `pwd` in bash already shows the worktree after rebind, the hook is a harmless no-op.

- **`permission.ask` hook**: Only auto-allows `external_directory` type for paths under the active worktree. Does NOT auto-allow `edit`, `bash`, or other tools — those have their own permission semantics. After the directory rebind, in-worktree paths should be internal (no `external_directory` prompt). The hook is belt-and-suspenders for the edge case where opencode's project root doesn't update after rebind.
