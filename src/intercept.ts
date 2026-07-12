const WORKTREE_CMD_RE = /git\s+worktree\s+(add|remove|move|prune)\b/;

function stripQuoted(cmd: string): string {
  return cmd.replace(/'[^']*'/g, '""').replace(/"[^"]*"/g, '""');
}

export function isWorktreeCommand(command: string): boolean {
  return WORKTREE_CMD_RE.test(stripQuoted(command));
}

export const WORKTREE_BLOCK_MESSAGE =
  "Direct 'git worktree <add|remove|move|prune>' commands are blocked. Use the worktrunk tools instead: worktrunk_create, worktrunk_switch, worktrunk_merge, worktrunk_remove, worktrunk_list.";
