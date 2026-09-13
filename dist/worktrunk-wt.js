// @bun
// src/worktrunk-wt.ts
import { tool } from "@opencode-ai/plugin";

// src/args.ts
function buildSwitchArgs(input) {
  const args = ["switch"];
  if (input.create)
    args.push("--create");
  if (input.base)
    args.push("--base", input.base);
  if (input.noHooks)
    args.push("--no-hooks");
  args.push("--no-cd", "--format", "json", "-y", input.branch);
  return args;
}
function buildMergeArgs(input) {
  const args = ["merge"];
  if (input.noRemove)
    args.push("--no-remove");
  if (input.noSquash)
    args.push("--no-squash");
  if (input.noHooks)
    args.push("--no-hooks");
  args.push("--format", "json", "-y");
  if (input.target)
    args.push(input.target);
  return args;
}
function buildListArgs() {
  return ["list", "--format", "json", "-y"];
}
function buildRemoveArgs(input) {
  const args = ["remove"];
  if (input.noHooks)
    args.push("--no-hooks");
  args.push("--format", "json", "-y", "--foreground", input.branch);
  return args;
}

// src/parse.ts
function parseJson(stdout, name) {
  try {
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(`${name} failed: ${e.message} (raw output: ${stdout.slice(0, 200)})`);
  }
}
function parseSwitchResult(stdout) {
  const raw = parseJson(stdout, "parseSwitchResult");
  return {
    action: raw.action,
    branch: raw.branch,
    path: raw.path,
    createdBranch: raw.created_branch ?? false,
    baseBranch: raw.base_branch
  };
}
function isDirty(wt) {
  if (!wt)
    return false;
  return Boolean(wt.modified || wt.staged || wt.untracked || wt.renamed || wt.deleted || wt.conflicted);
}
function normalizeListEntry(w) {
  const sync = w.remote ?? w.main ?? w.default_branch ?? {};
  return {
    branch: w.branch,
    path: w.worktree?.path ?? w.path,
    isMain: w.worktree?.main ?? w.is_main ?? false,
    isCurrent: w.worktree?.current ?? w.is_current ?? false,
    isPrevious: w.worktree?.previous ?? w.is_previous ?? false,
    mainState: w.main_state ?? w.display?.state,
    ahead: sync.ahead ?? 0,
    behind: sync.behind ?? 0,
    dirty: isDirty(w.worktree?.changes ?? w.working_tree)
  };
}
function parseListResult(stdout) {
  const parsed = parseJson(stdout, "parseListResult");
  const items = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null && Array.isArray(parsed.items) ? parsed.items : null;
  if (!items) {
    throw new Error(`parseListResult failed: unexpected shape (raw output: ${stdout.slice(0, 200)})`);
  }
  return items.map(normalizeListEntry);
}
function parseMergeResult(stdout) {
  const raw = parseJson(stdout, "parseMergeResult");
  return {
    branch: raw.branch,
    committed: raw.committed,
    rebased: raw.rebased,
    removed: raw.removed,
    squashed: raw.squashed,
    target: raw.target
  };
}
function parseRemoveResult(stdout) {
  const raw = parseJson(stdout, "parseRemoveResult");
  return raw.map((w) => ({
    branch: w.branch,
    branchDeleted: w.branch_deleted ?? false,
    kind: w.kind,
    path: w.path
  }));
}

// src/paths.ts
import path from "path";
import { realpathSync } from "fs";
function isUnderPath(childPath, parentPath) {
  const rel = path.relative(parentPath, childPath);
  if (rel === "")
    return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}
function resolvePath(p) {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

// src/state.ts
function createState() {
  const map = new Map;
  return {
    get(sessionID) {
      return map.get(sessionID);
    },
    set(sessionID, entry) {
      map.set(sessionID, entry);
    },
    clear(sessionID) {
      map.delete(sessionID);
    }
  };
}

// src/intercept.ts
var WORKTREE_CMD_RE = /git\s+worktree\s+(add|remove|move|prune)\b/;
function stripQuoted(cmd) {
  return cmd.replace(/'[^']*'/g, '""').replace(/"[^"]*"/g, '""');
}
function isWorktreeCommand(command) {
  return WORKTREE_CMD_RE.test(stripQuoted(command));
}
var WORKTREE_BLOCK_MESSAGE = "Direct 'git worktree <add|remove|move|prune>' commands are blocked. Use the worktrunk tools instead: worktrunk_create, worktrunk_switch, worktrunk_merge, worktrunk_remove, worktrunk_list.";

// src/bootstrap.ts
var SENTINEL = "WORKTRUNK_BOOTSTRAP";
var BOOTSTRAP_SENTINEL = SENTINEL;
function buildBootstrap() {
  return `<EXTREMELY_IMPORTANT>
<!-- ${SENTINEL} -->
**Always work in a worktree, never on \`main\`.** Use \`worktrunk_create\` before making any code changes (unless the human says otherwise).

**Tools:** \`worktrunk_create\` (new branch + worktree), \`worktrunk_switch\` (existing branch), \`worktrunk_list\` (show all), \`worktrunk_merge\` (merge back, removes worktree), \`worktrunk_remove\` (delete worktree \u2014 switch first if active).

**Rules:**
- \`git worktree\` is blocked \u2014 use the tools above.
- Never pass \`--yes\` for hook approvals \u2014 tell the user to run \`wt config approvals add\`.
- After create/switch, pass absolute paths to \`bash\` (workdir may not follow the rebind).
- When done, merge via \`worktrunk_merge\`.
</EXTREMELY_IMPORTANT>`;
}

// src/aliases.ts
var ALIAS_HEADER_RE = /^\u25CB Alias (.+) \(([^)]+)\):$/u;
function parseAliasShow(stdout) {
  const lines = stdout.split(/\r?\n/);
  const entries = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(ALIAS_HEADER_RE);
    if (m) {
      if (current)
        entries.push(current);
      current = { name: m[1].trim(), source: m[2].trim(), template: "" };
      continue;
    }
    if (current && line.startsWith("  ")) {
      current.template += (current.template ? `
` : "") + line.slice(2);
    }
  }
  if (current)
    entries.push(current);
  for (const e of entries) {
    e.template = e.template.replace(/\s+$/, "");
  }
  return entries;
}
function buildAliasArgs(name, args) {
  const out = [name];
  if (args)
    for (const a of args)
      out.push(a);
  return out;
}
function sanitizeAliasToolName(name) {
  return "worktrunk_alias_" + name.replace(/[^a-zA-Z0-9]+/g, "_");
}
function summarizeAliasTemplate(template, max = 160) {
  const collapsed = template.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? collapsed.slice(0, max) + "\u2026" : collapsed;
}

// src/worktrunk-wt.ts
var BOOTSTRAP = buildBootstrap();
var PERMISSION_MUTATION_TYPES = new Set(["external_directory", "edit", "write", "patch"]);
var worktrunk_wt_default = async ({ $, worktree: projectRoot, client }) => {
  const state = createState();
  const httpClient = client._client;
  async function runWt(args, opts) {
    const root = opts?.cwd ?? projectRoot;
    try {
      if (opts?.mergeStderr) {
        return await $`wt -C ${root} ${args} 2>&1`.quiet().nothrow().text();
      }
      let cmd = $`wt -C ${root} ${args}`.quiet();
      if (opts?.nothrow)
        cmd = cmd.nothrow();
      return await cmd.text();
    } catch (err) {
      const raw = err.stderr ?? err.stdout ?? err.message ?? "";
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      throw new Error(`wt ${args.join(" ")} failed (exit ${err.exitCode}): ${text.trim()}`);
    }
  }
  async function rebindDirectory(sessionID, directory) {
    const result = await httpClient.post({
      url: "/experimental/control-plane/move-session",
      body: {
        sessionID,
        destination: { directory },
        moveChanges: false
      },
      headers: { "Content-Type": "application/json" }
    });
    if (result.error) {
      throw new Error(`move-session failed (${result.response?.status ?? "unknown"}): ${JSON.stringify(result.error)}`);
    }
  }
  async function resolveWorktreePath(branch) {
    const stdout = await runWt(buildListArgs());
    const list = parseListResult(stdout);
    const entry = list.find((w) => w.branch === branch);
    return entry?.path ?? null;
  }
  function makeAliasTool(alias) {
    const snippet = summarizeAliasTemplate(alias.template);
    const isPipeline = alias.template.includes(`
`);
    return tool({
      description: `Run the worktrunk alias "${alias.name}" (${alias.source} config).` + (isPipeline ? " Multi-step pipeline." : "") + ` Template: ${snippet}.` + ` Forwards 'args' to the alias (positionals land in {{ args }}, --KEY=VALUE binds template vars).` + ` Runs in the session's current worktree so {{ branch }} resolves correctly.` + ` Does NOT rebind the session directory \u2014 if this alias wraps 'wt switch'/'merge', prefer the dedicated worktrunk_create/switch/merge tools.` + ` If it fails needing alias/hook approval, tell the user to run 'wt config approvals add'.`,
      args: {
        args: tool.schema.array(tool.schema.string()).optional().describe("Positional arguments and --KEY=VALUE flags forwarded to the alias.")
      },
      async execute(toolArgs, context) {
        const cwd = context.directory ?? projectRoot;
        const wtArgs = buildAliasArgs(alias.name, toolArgs.args ?? undefined);
        const output = await runWt(wtArgs, { cwd, mergeStderr: true });
        return output.trim().length ? output : `Alias "${alias.name}" completed (no output).`;
      }
    });
  }
  const tools = {
    worktrunk_create: tool({
      description: "Create a new git worktree on a new branch using worktrunk (wt). Switches the session's working directory to the new worktree. The agent then works from that worktree without permission prompts.",
      args: {
        branch: tool.schema.string().describe("New branch name for the worktree"),
        base: tool.schema.string().optional().describe("Base branch to create from (defaults to default branch). Supports: ^, @, -, pr:{N}"),
        noHooks: tool.schema.boolean().optional().describe("Skip wt project hooks (pre-start, etc.)")
      },
      async execute(args, context) {
        const { sessionID } = context;
        const wtArgs = buildSwitchArgs({
          branch: args.branch,
          create: true,
          base: args.base ?? undefined,
          noHooks: args.noHooks ?? undefined
        });
        const stdout = await runWt(wtArgs);
        const result = parseSwitchResult(stdout);
        try {
          await rebindDirectory(sessionID, result.path);
        } catch (err) {
          throw new Error(`Worktree created at ${result.path} but session directory rebind failed: ${err.message}. The worktree exists on disk; inform the user they may need to restart opencode.`);
        }
        state.set(sessionID, {
          worktreePath: result.path,
          branch: result.branch
        });
        return `Created worktree for branch "${result.branch}" at ${result.path}. Session working directory is now ${result.path}.`;
      }
    }),
    worktrunk_switch: tool({
      description: "Switch the session to an existing git worktree using worktrunk (wt). Creates a worktree for the branch if one doesn't exist yet (but the branch must already exist). Switches the session's working directory to the worktree. Use worktrunk_create to create a new branch.",
      args: {
        branch: tool.schema.string().describe("Branch name to switch to. Supports: ^, @, -, pr:{N}"),
        noHooks: tool.schema.boolean().optional().describe("Skip wt project hooks")
      },
      async execute(args, context) {
        const { sessionID } = context;
        const wtArgs = buildSwitchArgs({
          branch: args.branch,
          create: false,
          noHooks: args.noHooks ?? undefined
        });
        const stdout = await runWt(wtArgs);
        const result = parseSwitchResult(stdout);
        try {
          await rebindDirectory(sessionID, result.path);
        } catch (err) {
          throw new Error(`Worktree switched to at ${result.path} but session directory rebind failed: ${err.message}. The worktree exists on disk; inform the user they may need to restart opencode.`);
        }
        state.set(sessionID, {
          worktreePath: result.path,
          branch: result.branch
        });
        return `Switched to worktree for branch "${result.branch}" at ${result.path}. Session working directory is now ${result.path}.`;
      }
    }),
    worktrunk_merge: tool({
      description: "Merge the current branch into the target branch (defaults to default branch) using worktrunk (wt). Squashes and rebases by default. Removes the current worktree after merge and switches the session to the target branch's worktree. If project hooks need approval and haven't been approved, the merge will fail \u2014 tell the user to run 'wt config approvals add'.",
      args: {
        target: tool.schema.string().optional().describe("Target branch to merge into (defaults to default branch)"),
        noRemove: tool.schema.boolean().optional().describe("Keep the worktree after merging"),
        noSquash: tool.schema.boolean().optional().describe("Preserve individual commits (no squash)"),
        noHooks: tool.schema.boolean().optional().describe("Skip wt project hooks (pre-merge, pre-remove, etc.)")
      },
      async execute(args, context) {
        const { sessionID } = context;
        const wtArgs = buildMergeArgs({
          target: args.target ?? undefined,
          noRemove: args.noRemove ?? undefined,
          noSquash: args.noSquash ?? undefined,
          noHooks: args.noHooks ?? undefined
        });
        let branchMap = {};
        try {
          const listStdout = await runWt(buildListArgs());
          branchMap = Object.fromEntries(parseListResult(listStdout).map((w) => [w.branch, w.path]));
        } catch {}
        const stdout = await runWt(wtArgs, { nothrow: true });
        if (!stdout.trim()) {
          throw new Error("wt merge produced no output. The merge likely failed -- check for unapproved hooks " + "(run 'wt config approvals add') or merge conflicts.");
        }
        const result = parseMergeResult(stdout);
        let targetPath = branchMap[result.target] ?? null;
        if (!targetPath) {
          try {
            targetPath = await resolveWorktreePath(result.target);
          } catch {}
        }
        if (!targetPath) {
          throw new Error(`Merge succeeded but could not find worktree for target branch "${result.target}". ` + `Run 'wt list' to check.`);
        }
        try {
          await rebindDirectory(sessionID, targetPath);
        } catch (err) {
          throw new Error(`Worktree merged to at ${targetPath} but session directory rebind failed: ${err.message}. The worktree exists on disk; inform the user they may need to restart opencode.`);
        }
        state.set(sessionID, {
          worktreePath: targetPath,
          branch: result.target
        });
        return `Merged to "${result.target}". Worktree removed: ${result.removed}. Session working directory is now ${targetPath}.`;
      }
    }),
    worktrunk_list: tool({
      description: "List all git worktrees in the repository using worktrunk (wt). Marks the active worktree (the one the session is currently in).",
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
          isMain: w.isMain
        }));
        return JSON.stringify(result, null, 2);
      }
    }),
    worktrunk_remove: tool({
      description: "Remove a git worktree and its branch (if merged) using worktrunk (wt). Cannot remove the worktree the session is currently in \u2014 switch to another worktree first.",
      args: {
        branch: tool.schema.string().describe("Branch name of the worktree to remove"),
        noHooks: tool.schema.boolean().optional().describe("Skip wt project hooks")
      },
      async execute(args, context) {
        const { directory, sessionID } = context;
        const listStdout = await runWt(buildListArgs());
        const list = parseListResult(listStdout);
        const target = list.find((w) => w.branch === args.branch);
        if (!target) {
          throw new Error(`No worktree found for branch "${args.branch}". Run 'worktrunk_list' to see available worktrees.`);
        }
        const resolvedDir = resolvePath(directory);
        const resolvedTarget = resolvePath(target.path);
        if (isUnderPath(resolvedDir, resolvedTarget)) {
          throw new Error(`Cannot remove the active worktree (branch "${args.branch}"). Use worktrunk_switch to switch to another worktree first.`);
        }
        const entry = state.get(sessionID);
        if (entry && resolvePath(entry.worktreePath) === resolvedTarget) {
          throw new Error(`Cannot remove the active worktree (branch "${args.branch}"). Use worktrunk_switch to switch to another worktree first.`);
        }
        const wtArgs = buildRemoveArgs({
          branch: args.branch,
          noHooks: args.noHooks ?? undefined
        });
        const stdout = await runWt(wtArgs);
        const result = parseRemoveResult(stdout);
        return `Removed worktree for branch "${args.branch}". Branch deleted: ${result[0]?.branchDeleted ?? false}.`;
      }
    })
  };
  try {
    const showStdout = await runWt(["config", "alias", "show"], {
      nothrow: true,
      mergeStderr: true
    });
    for (const alias of parseAliasShow(showStdout)) {
      const key = sanitizeAliasToolName(alias.name);
      if (tools[key])
        continue;
      tools[key] = makeAliasTool(alias);
    }
  } catch {}
  return {
    tool: tools,
    "permission.ask": async (input, output) => {
      if (!PERMISSION_MUTATION_TYPES.has(input.type))
        return;
      const entry = state.get(input.sessionID);
      if (!entry)
        return;
      const patterns = Array.isArray(input.pattern) ? input.pattern : input.pattern ? [input.pattern] : [];
      if (patterns.length === 0)
        return;
      const wtPath = resolvePath(entry.worktreePath);
      const allUnder = patterns.every((p) => {
        if (typeof p !== "string")
          return false;
        const clean = p.replace(/\/\*+$/, "").replace(/\/$/, "");
        return isUnderPath(resolvePath(clean), wtPath);
      });
      if (allUnder)
        output.status = "allow";
    },
    "shell.env": async (input, output) => {
      const entry = state.get(input.sessionID ?? "");
      if (entry) {
        output.env.PWD = entry.worktreePath;
      }
    },
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const sessionID = event.properties?.info?.id;
        if (typeof sessionID === "string") {
          state.clear(sessionID);
        }
      }
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash")
        return;
      const command = output.args?.command;
      if (typeof command !== "string")
        return;
      if (isWorktreeCommand(command)) {
        throw new Error(WORKTREE_BLOCK_MESSAGE);
      }
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages.length)
        return;
      const firstUser = output.messages.find((m) => m.info.role === "user");
      if (!firstUser || !firstUser.parts.length)
        return;
      if (firstUser.parts.some((p) => p.type === "text" && p.text.includes(BOOTSTRAP_SENTINEL)))
        return;
      firstUser.parts.unshift({ type: "text", text: BOOTSTRAP });
    }
  };
};
export {
  worktrunk_wt_default as default
};
