import { execFile, type ExecException } from "node:child_process";
import { Plugin } from "@opencode/plugin";
import { buildSwitchArgs, buildMergeArgs, buildListArgs, buildRemoveArgs } from "./args";
import { parseSwitchResult, parseListResult, parseMergeResult, parseRemoveResult, isNoOpMerge } from "./parse";
import { isUnderPath, resolvePath } from "./paths";
import { createState } from "./state";
import { isWorktreeCommand, WORKTREE_BLOCK_MESSAGE } from "./intercept";
import { buildBootstrap } from "./bootstrap";
import {
  parseAliasShow,
  buildAliasArgs,
  sanitizeAliasToolName,
  summarizeAliasTemplate,
  type AliasEntry,
} from "./aliases";

const BOOTSTRAP = buildBootstrap();
const PERMISSION_MUTATION_ACTIONS = new Set(["external_directory", "edit"]);

function runWt(
  projectRoot: string,
  args: string[],
  opts?: { nothrow?: boolean; cwd?: string; mergeStderr?: boolean },
): Promise<string> {
  const root = opts?.cwd ?? projectRoot;
  return new Promise((resolve, reject) => {
    execFile("wt", ["-C", root, ...args], { maxBuffer: 16 * 1024 * 1024 }, (error: ExecException | null, stdout: string | Buffer, stderr: string | Buffer) => {
      const out = stdout.toString();
      const err = stderr.toString();
      if (opts?.mergeStderr) {
        resolve(out + err);
        return;
      }
      if (error && !opts?.nothrow) {
        const code: unknown = (error as { code?: unknown }).code;
        reject(new Error(`wt ${args.join(" ")} failed (exit ${String(code)}): ${(err || error.message).trim()}`));
        return;
      }
      resolve(out);
    });
  });
}

const BUILTIN_TOOL_NAMES = new Set([
  "worktrunk_create",
  "worktrunk_switch",
  "worktrunk_merge",
  "worktrunk_list",
  "worktrunk_remove",
]);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default Plugin.define({
  id: "worktrunk",
  async setup(ctx) {
    const state = createState();
    const projectRoot = ctx.location.project.canonical;

    async function sessionDirectory(sessionID: string): Promise<string> {
      const session = await ctx.session.get({ sessionID });
      return session.location.directory;
    }

    async function moveSession(sessionID: string, directory: string): Promise<void> {
      await ctx.session.move({ sessionID, directory: directory as typeof projectRoot, delivery: "steer" });
    }

    async function resolveWorktreePath(branch: string): Promise<string | null> {
      const stdout = await runWt(projectRoot, buildListArgs());
      const list = parseListResult(stdout);
      const entry = list.find((w) => w.branch === branch);
      return entry?.path ?? null;
    }

    async function loadAliases(): Promise<AliasEntry[]> {
      try {
        const showStdout = await runWt(projectRoot, ["config", "alias", "show"], { mergeStderr: true });
        return parseAliasShow(showStdout);
      } catch {
        return [];
      }
    }

    const aliases = await loadAliases();

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "worktrunk_create",
        description:
          "Create a new git worktree on a new branch using worktrunk (wt). Switches the session's working directory to the new worktree. The agent then works from that worktree without permission prompts.",
        input: {
          type: "object",
          properties: {
            branch: { type: "string", description: "New branch name for the worktree" },
            base: {
              type: "string",
              description: "Base branch to create from (defaults to default branch). Supports: ^, @, -, pr:{N}",
            },
            noHooks: { type: "boolean", description: "Skip wt project hooks (pre-start, etc.)" },
          },
          required: ["branch"],
          additionalProperties: false,
        },
        execute: async (input, tool) => {
          const args = input as { branch: string; base?: string; noHooks?: boolean };
          const wtArgs = buildSwitchArgs({
            branch: args.branch,
            create: true,
            base: args.base ?? undefined,
            noHooks: args.noHooks ?? undefined,
          });
          const stdout = await runWt(projectRoot, wtArgs);
          const result = parseSwitchResult(stdout);
          try {
            await moveSession(tool.sessionID, result.path);
          } catch (err) {
            throw new Error(
              `Worktree created at ${result.path} but session directory move failed: ${errorMessage(err)}. The worktree exists on disk; inform the user they may need to restart opencode.`,
            );
          }
          state.set(tool.sessionID, {
            worktreePath: result.path,
            branch: result.branch,
          });
          return {
            content: `Created worktree for branch "${result.branch}" at ${result.path}. Session working directory is now ${result.path}.`,
          };
        },
      });

      editor.add({
        name: "worktrunk_switch",
        description:
          "Switch the session to an existing git worktree using worktrunk (wt). Creates a worktree for the branch if one doesn't exist yet (but the branch must already exist). Switches the session's working directory to the worktree. Use worktrunk_create to create a new branch.",
        input: {
          type: "object",
          properties: {
            branch: { type: "string", description: "Branch name to switch to. Supports: ^, @, -, pr:{N}" },
            noHooks: { type: "boolean", description: "Skip wt project hooks" },
          },
          required: ["branch"],
          additionalProperties: false,
        },
        execute: async (input, tool) => {
          const args = input as { branch: string; noHooks?: boolean };
          const wtArgs = buildSwitchArgs({
            branch: args.branch,
            create: false,
            noHooks: args.noHooks ?? undefined,
          });
          const stdout = await runWt(projectRoot, wtArgs);
          const result = parseSwitchResult(stdout);
          try {
            await moveSession(tool.sessionID, result.path);
          } catch (err) {
            throw new Error(
              `Worktree switched to at ${result.path} but session directory move failed: ${errorMessage(err)}. The worktree exists on disk; inform the user they may need to restart opencode.`,
            );
          }
          state.set(tool.sessionID, {
            worktreePath: result.path,
            branch: result.branch,
          });
          return {
            content: `Switched to worktree for branch "${result.branch}" at ${result.path}. Session working directory is now ${result.path}.`,
          };
        },
      });

      editor.add({
        name: "worktrunk_merge",
        description:
          "Merge the current branch into the target branch (defaults to default branch) using worktrunk (wt). Squashes and rebases by default. Removes the current worktree after merge and switches the session to the target branch's worktree. If project hooks need approval and haven't been approved, the merge will fail — tell the user to run 'wt config approvals add'.",
        input: {
          type: "object",
          properties: {
            target: { type: "string", description: "Target branch to merge into (defaults to default branch)" },
            noRemove: { type: "boolean", description: "Keep the worktree after merging" },
            noSquash: { type: "boolean", description: "Preserve individual commits (no squash)" },
            noHooks: { type: "boolean", description: "Skip wt project hooks (pre-merge, pre-remove, etc.)" },
          },
          additionalProperties: false,
        },
        execute: async (input, tool) => {
          const args = input as { target?: string; noRemove?: boolean; noSquash?: boolean; noHooks?: boolean };
          const wtArgs = buildMergeArgs({
            target: args.target ?? undefined,
            noRemove: args.noRemove ?? undefined,
            noSquash: args.noSquash ?? undefined,
            noHooks: args.noHooks ?? undefined,
          });

          let cwd: string = projectRoot;
          try {
            cwd = await sessionDirectory(tool.sessionID);
          } catch {
            cwd = projectRoot;
          }

          let branchMap: Record<string, string> = {};
          let sourceBranch: string | null = null;
          let defaultBranch: string | null = null;
          try {
            const listStdout = await runWt(projectRoot, buildListArgs(), { cwd });
            const list = parseListResult(listStdout);
            branchMap = Object.fromEntries(list.map((w) => [w.branch, w.path]));
            const resolvedCwd = resolvePath(cwd);
            sourceBranch =
              list.find((w) => isUnderPath(resolvedCwd, resolvePath(w.path)))?.branch ??
              state.get(tool.sessionID)?.branch ??
              null;
            defaultBranch = list.find((w) => w.isMain)?.branch ?? null;
          } catch {
            // List failed -- we'll try resolveWorktreePath after merge as fallback
          }

          const effectiveTarget = args.target ?? defaultBranch ?? null;
          if (sourceBranch && effectiveTarget && sourceBranch === effectiveTarget) {
            throw new Error(
              `Merge refused: session is in "${sourceBranch}", which is already the target branch. ` +
                `Switch to the feature worktree first (worktrunk_switch), then merge. Nothing was merged.`,
            );
          }

          const stdout = await runWt(projectRoot, wtArgs, { nothrow: true, cwd });
          if (!stdout.trim()) {
            throw new Error(
              "wt merge produced no output. The merge likely failed -- check for unapproved hooks " +
                "(run 'wt config approvals add') or merge conflicts.",
            );
          }
          const result = parseMergeResult(stdout);
          if (isNoOpMerge(result)) {
            throw new Error(
              `wt merge merged nothing: it ran in "${result.branch}", which is also the target. ` +
                `The session was in "${sourceBranch ?? cwd}". Switch to the feature worktree first (worktrunk_switch), then merge. ` +
                `Verify with 'wt list' -- the feature branch should still exist with its commits.`,
            );
          }

          let targetPath: string | null = branchMap[result.target] ?? null;
          if (!targetPath) {
            try {
              targetPath = await resolveWorktreePath(result.target);
            } catch {
              // resolveWorktreePath may fail if projectRoot points to removed worktree
            }
          }

          if (!targetPath) {
            throw new Error(
              `Merge succeeded but could not find worktree for target branch "${result.target}". ` +
                `Run 'wt list' to check.`,
            );
          }

          try {
            await moveSession(tool.sessionID, targetPath);
          } catch (err) {
            throw new Error(
              `Worktree merged to at ${targetPath} but session directory move failed: ${errorMessage(err)}. The worktree exists on disk; inform the user they may need to restart opencode.`,
            );
          }
          state.set(tool.sessionID, {
            worktreePath: targetPath,
            branch: result.target,
          });
          return {
            content: `Merged to "${result.target}". Worktree removed: ${result.removed}. Session working directory is now ${targetPath}.`,
          };
        },
      });

      editor.add({
        name: "worktrunk_list",
        description:
          "List all git worktrees in the repository using worktrunk (wt). Marks the active worktree (the one the session is currently in).",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async (_input, tool) => {
          const directory = await sessionDirectory(tool.sessionID);
          const stdout = await runWt(projectRoot, buildListArgs());
          const list = parseListResult(stdout);
          const resolvedDir = resolvePath(directory);
          const result = list.map((w) => ({
            branch: w.branch,
            path: w.path,
            active: isUnderPath(resolvedDir, resolvePath(w.path)),
            isMain: w.isMain,
          }));
          return { content: JSON.stringify(result, null, 2) };
        },
      });

      editor.add({
        name: "worktrunk_remove",
        description:
          "Remove a git worktree and its branch (if merged) using worktrunk (wt). Cannot remove the worktree the session is currently in — switch to another worktree first.",
        input: {
          type: "object",
          properties: {
            branch: { type: "string", description: "Branch name of the worktree to remove" },
            noHooks: { type: "boolean", description: "Skip wt project hooks" },
          },
          required: ["branch"],
          additionalProperties: false,
        },
        execute: async (input, tool) => {
          const args = input as { branch: string; noHooks?: boolean };
          const directory = await sessionDirectory(tool.sessionID);
          const listStdout = await runWt(projectRoot, buildListArgs());
          const list = parseListResult(listStdout);
          const target = list.find((w) => w.branch === args.branch);

          if (!target) {
            throw new Error(
              `No worktree found for branch "${args.branch}". Run 'worktrunk_list' to see available worktrees.`,
            );
          }

          const resolvedDir = resolvePath(directory);
          const resolvedTarget = resolvePath(target.path);
          if (isUnderPath(resolvedDir, resolvedTarget)) {
            throw new Error(
              `Cannot remove the active worktree (branch "${args.branch}"). Use worktrunk_switch to switch to another worktree first.`,
            );
          }

          const entry = state.get(tool.sessionID);
          if (entry && resolvePath(entry.worktreePath) === resolvedTarget) {
            throw new Error(
              `Cannot remove the active worktree (branch "${args.branch}"). Use worktrunk_switch to switch to another worktree first.`,
            );
          }

          const wtArgs = buildRemoveArgs({
            branch: args.branch,
            noHooks: args.noHooks ?? undefined,
          });
          const stdout = await runWt(projectRoot, wtArgs);
          const result = parseRemoveResult(stdout);
          return {
            content: `Removed worktree for branch "${args.branch}". Branch deleted: ${result[0]?.branchDeleted ?? false}.`,
          };
        },
      });

      for (const alias of aliases) {
        const key = sanitizeAliasToolName(alias.name);
        if (BUILTIN_TOOL_NAMES.has(key)) continue;
        const snippet = summarizeAliasTemplate(alias.template);
        const isPipeline = alias.template.includes("\n");
        editor.add({
          name: key,
          description:
            `Run the worktrunk alias "${alias.name}" (${alias.source} config).` +
            (isPipeline ? " Multi-step pipeline." : "") +
            ` Template: ${snippet}.` +
            ` Forwards 'args' to the alias (positionals land in {{ args }}, --KEY=VALUE binds template vars).` +
            ` Runs in the session's current worktree so {{ branch }} resolves correctly.` +
            ` Does NOT move the session directory — if this alias wraps 'wt switch'/'merge', prefer the dedicated worktrunk_create/switch/merge tools.` +
            ` If it fails needing alias/hook approval, tell the user to run 'wt config approvals add'.`,
          input: {
            type: "object",
            properties: {
              args: {
                type: "array",
                items: { type: "string" },
                description: "Positional arguments and --KEY=VALUE flags forwarded to the alias.",
              },
            },
            additionalProperties: false,
          },
          execute: async (input, tool) => {
            const aliasArgs = input as { args?: string[] };
            let cwd: string = projectRoot;
            try {
              cwd = await sessionDirectory(tool.sessionID);
            } catch {
              cwd = projectRoot;
            }
            const wtArgs = buildAliasArgs(alias.name, aliasArgs.args ?? undefined);
            const output = await runWt(projectRoot, wtArgs, { cwd, mergeStderr: true });
            return { content: output.trim().length ? output : `Alias "${alias.name}" completed (no output).` };
          },
        });
      }
    });

    await ctx.permission.hook("evaluate", (event) => {
      if (!PERMISSION_MUTATION_ACTIONS.has(event.action)) return;
      const entry = state.get(event.sessionID);
      if (!entry) return;
      if (event.resources.length === 0) return;
      const wtPath = resolvePath(entry.worktreePath);
      const allUnder = event.resources.every((p) => {
        if (typeof p !== "string") return false;
        const clean = p.replace(/\/\*+$/, "").replace(/\/$/, "");
        return isUnderPath(resolvePath(clean), wtPath);
      });
      if (allUnder) event.effect = "allow";
    });

    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool !== "shell" && event.tool !== "bash") return;
      const command = (event.input as { command?: unknown } | null)?.command;
      if (typeof command !== "string") return;
      if (isWorktreeCommand(command)) {
        throw new Error(WORKTREE_BLOCK_MESSAGE);
      }
    });

    await ctx.session.hook("context", (event) => {
      event.system.push({ type: "text", text: BOOTSTRAP });
    });

    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type === "session.deleted") {
            const sessionID = (event as unknown as { data?: { sessionID?: unknown } }).data?.sessionID;
            if (typeof sessionID === "string") {
              state.clear(sessionID);
            }
          }
        }
      } catch {
        // Subscription ended (aborted on unload)
      }
    })();

    return () => controller.abort();
  },
});
