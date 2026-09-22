import type { Plugin } from "@opencode-ai/plugin";
import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { buildSwitchArgs, buildMergeArgs, buildListArgs, buildRemoveArgs } from "./args";
import { parseSwitchResult, parseListResult, parseMergeResult, parseRemoveResult, isNoOpMerge } from "./parse";
import { isUnderPath, resolvePath } from "./paths";
import { createState } from "./state";
import { isWorktreeCommand, WORKTREE_BLOCK_MESSAGE } from "./intercept";
import { buildBootstrap, BOOTSTRAP_SENTINEL } from "./bootstrap";
import {
  parseAliasShow,
  buildAliasArgs,
  sanitizeAliasToolName,
  summarizeAliasTemplate,
  type AliasEntry,
} from "./aliases";

const BOOTSTRAP = buildBootstrap();
const PERMISSION_MUTATION_TYPES = new Set(["external_directory", "edit", "write", "patch"]);

export default (async ({ $, worktree: projectRoot, client }) => {
  const state = createState();

  const httpClient = (
    client as unknown as {
      _client: {
        post: (opts: { url: string; body: unknown; headers: Record<string, string> }) => Promise<{
          data?: unknown;
          error?: unknown;
          response?: { status: number };
        }>;
      };
    }
  )._client;

  async function runWt(
    args: string[],
    opts?: { nothrow?: boolean; cwd?: string; mergeStderr?: boolean },
  ): Promise<string> {
    const root = opts?.cwd ?? projectRoot;
    try {
      if (opts?.mergeStderr) {
        return await $`wt -C ${root} ${args} 2>&1`.quiet().nothrow().text();
      }
      let cmd = $`wt -C ${root} ${args}`.quiet();
      if (opts?.nothrow) cmd = cmd.nothrow();
      return await cmd.text();
    } catch (err: any) {
      const raw = err.stderr ?? err.stdout ?? err.message ?? "";
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      throw new Error(`wt ${args.join(" ")} failed (exit ${err.exitCode}): ${text.trim()}`);
    }
  }

  async function rebindDirectory(sessionID: string, directory: string): Promise<void> {
    const result = await httpClient.post({
      url: "/experimental/control-plane/move-session",
      body: {
        sessionID,
        destination: { directory },
        moveChanges: false,
      },
      headers: { "Content-Type": "application/json" },
    });
    if (result.error) {
      throw new Error(`move-session failed (${result.response?.status ?? "unknown"}): ${JSON.stringify(result.error)}`);
    }
  }

  async function resolveWorktreePath(branch: string): Promise<string | null> {
    const stdout = await runWt(buildListArgs());
    const list = parseListResult(stdout);
    const entry = list.find((w) => w.branch === branch);
    return entry?.path ?? null;
  }

  function makeAliasTool(alias: AliasEntry): ToolDefinition {
    const snippet = summarizeAliasTemplate(alias.template);
    const isPipeline = alias.template.includes("\n");
    return tool({
      description:
        `Run the worktrunk alias "${alias.name}" (${alias.source} config).` +
        (isPipeline ? " Multi-step pipeline." : "") +
        ` Template: ${snippet}.` +
        ` Forwards 'args' to the alias (positionals land in {{ args }}, --KEY=VALUE binds template vars).` +
        ` Runs in the session's current worktree so {{ branch }} resolves correctly.` +
        ` Does NOT rebind the session directory — if this alias wraps 'wt switch'/'merge', prefer the dedicated worktrunk_create/switch/merge tools.` +
        ` If it fails needing alias/hook approval, tell the user to run 'wt config approvals add'.`,
      args: {
        args: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe("Positional arguments and --KEY=VALUE flags forwarded to the alias."),
      },
      async execute(toolArgs, context) {
        const cwd = context.directory ?? projectRoot;
        const wtArgs = buildAliasArgs(alias.name, toolArgs.args ?? undefined);
        const output = await runWt(wtArgs, { cwd, mergeStderr: true });
        return output.trim().length ? output : `Alias "${alias.name}" completed (no output).`;
      },
    });
  }

  const tools: Record<string, ToolDefinition> = {
    worktrunk_create: tool({
      description:
        "Create a new git worktree on a new branch using worktrunk (wt). Switches the session's working directory to the new worktree. The agent then works from that worktree without permission prompts.",
      args: {
        branch: tool.schema.string().describe("New branch name for the worktree"),
        base: tool.schema
          .string()
          .optional()
          .describe("Base branch to create from (defaults to default branch). Supports: ^, @, -, pr:{N}"),
        noHooks: tool.schema.boolean().optional().describe("Skip wt project hooks (pre-start, etc.)"),
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
        try {
          await rebindDirectory(sessionID, result.path);
        } catch (err: any) {
          throw new Error(
            `Worktree created at ${result.path} but session directory rebind failed: ${err.message}. The worktree exists on disk; inform the user they may need to restart opencode.`,
          );
        }
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
        branch: tool.schema.string().describe("Branch name to switch to. Supports: ^, @, -, pr:{N}"),
        noHooks: tool.schema.boolean().optional().describe("Skip wt project hooks"),
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
        try {
          await rebindDirectory(sessionID, result.path);
        } catch (err: any) {
          throw new Error(
            `Worktree switched to at ${result.path} but session directory rebind failed: ${err.message}. The worktree exists on disk; inform the user they may need to restart opencode.`,
          );
        }
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
        target: tool.schema.string().optional().describe("Target branch to merge into (defaults to default branch)"),
        noRemove: tool.schema.boolean().optional().describe("Keep the worktree after merging"),
        noSquash: tool.schema.boolean().optional().describe("Preserve individual commits (no squash)"),
        noHooks: tool.schema.boolean().optional().describe("Skip wt project hooks (pre-merge, pre-remove, etc.)"),
      },
      async execute(args, context) {
        const { sessionID, directory } = context;
        const wtArgs = buildMergeArgs({
          target: args.target ?? undefined,
          noRemove: args.noRemove ?? undefined,
          noSquash: args.noSquash ?? undefined,
          noHooks: args.noHooks ?? undefined,
        });

        const cwd = directory ?? projectRoot;

        // Build branch->path map BEFORE merge removes source worktree
        let branchMap: Record<string, string> = {};
        let sourceBranch: string | null = null;
        let defaultBranch: string | null = null;
        try {
          const listStdout = await runWt(buildListArgs(), { cwd });
          const list = parseListResult(listStdout);
          branchMap = Object.fromEntries(list.map((w) => [w.branch, w.path]));
          const resolvedCwd = resolvePath(cwd);
          sourceBranch =
            list.find((w) => isUnderPath(resolvedCwd, resolvePath(w.path)))?.branch ??
            state.get(sessionID)?.branch ??
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

        // Run merge (nothrow because wt merge may exit non-zero even on success -- see #175)
        const stdout = await runWt(wtArgs, { nothrow: true, cwd });
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

        // Use pre-built map to find target worktree; fall back to resolveWorktreePath
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
          await rebindDirectory(sessionID, targetPath);
        } catch (err: any) {
          throw new Error(
            `Worktree merged to at ${targetPath} but session directory rebind failed: ${err.message}. The worktree exists on disk; inform the user they may need to restart opencode.`,
          );
        }
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
        branch: tool.schema.string().describe("Branch name of the worktree to remove"),
        noHooks: tool.schema.boolean().optional().describe("Skip wt project hooks"),
      },
      async execute(args, context) {
        const { directory, sessionID } = context;
        const listStdout = await runWt(buildListArgs());
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

        const entry = state.get(sessionID);
        if (entry && resolvePath(entry.worktreePath) === resolvedTarget) {
          throw new Error(
            `Cannot remove the active worktree (branch "${args.branch}"). Use worktrunk_switch to switch to another worktree first.`,
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
  };

  try {
    const showStdout = await runWt(["config", "alias", "show"], {
      nothrow: true,
      mergeStderr: true,
    });
    for (const alias of parseAliasShow(showStdout)) {
      const key = sanitizeAliasToolName(alias.name);
      if (tools[key]) continue;
      tools[key] = makeAliasTool(alias);
    }
  } catch {
    // aliases unavailable; expose only built-in tools
  }

  return {
    tool: tools,

    "permission.ask": async (input, output) => {
      if (!PERMISSION_MUTATION_TYPES.has(input.type)) return;
      const entry = state.get(input.sessionID);
      if (!entry) return;
      const patterns = Array.isArray(input.pattern) ? input.pattern : input.pattern ? [input.pattern] : [];
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

    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return;
      const command = output.args?.command;
      if (typeof command !== "string") return;
      if (isWorktreeCommand(command)) {
        throw new Error(WORKTREE_BLOCK_MESSAGE);
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages.length) return;
      const firstUser = output.messages.find((m) => m.info.role === "user");
      if (!firstUser || !firstUser.parts.length) return;
      if (firstUser.parts.some((p) => p.type === "text" && p.text.includes(BOOTSTRAP_SENTINEL))) return;
      firstUser.parts.unshift({ type: "text", text: BOOTSTRAP } as (typeof firstUser.parts)[number]);
    },
  };
}) satisfies Plugin;
