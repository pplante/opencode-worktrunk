const SENTINEL = "WORKTRUNK_BOOTSTRAP";

export const BOOTSTRAP_SENTINEL = SENTINEL;

export function buildBootstrap(): string {
  return `<EXTREMELY_IMPORTANT>
<!-- ${SENTINEL} -->
**Always work in a worktree, never on \`main\`.** Use \`worktrunk_create\` before making any code changes (unless the human says otherwise).

**Tools:** \`worktrunk_create\` (new branch + worktree), \`worktrunk_switch\` (existing branch), \`worktrunk_list\` (show all), \`worktrunk_merge\` (merge back, removes worktree), \`worktrunk_remove\` (delete worktree — switch first if active).

**Rules:**
- \`git worktree\` is blocked — use the tools above.
- Never pass \`--yes\` for hook approvals — tell the user to run \`wt config approvals add\`.
- After create/switch, pass absolute paths to \`bash\` (workdir may not follow the rebind).
- When done, merge via \`worktrunk_merge\`.
</EXTREMELY_IMPORTANT>`;
}
