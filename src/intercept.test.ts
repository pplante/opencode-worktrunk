import { describe, expect, test } from "bun:test";
import { isWorktreeCommand, WORKTREE_BLOCK_MESSAGE } from "./intercept";

describe("isWorktreeCommand", () => {
  test("blocks git worktree add", () => {
    expect(isWorktreeCommand("git worktree add ../feature")).toBe(true);
  });

  test("blocks git worktree remove", () => {
    expect(isWorktreeCommand("git worktree remove ../feature")).toBe(true);
  });

  test("blocks git worktree move", () => {
    expect(isWorktreeCommand("git worktree move ../feature ../new-location")).toBe(true);
  });

  test("blocks git worktree prune", () => {
    expect(isWorktreeCommand("git worktree prune")).toBe(true);
  });

  test("allows git worktree list", () => {
    expect(isWorktreeCommand("git worktree list")).toBe(false);
  });

  test("allows git worktree lock", () => {
    expect(isWorktreeCommand("git worktree lock ../feature")).toBe(false);
  });

  test("allows regular git commands", () => {
    expect(isWorktreeCommand("git checkout main")).toBe(false);
    expect(isWorktreeCommand("git commit -m 'fix'")).toBe(false);
    expect(isWorktreeCommand("git push origin main")).toBe(false);
  });

  test("allows non-git commands", () => {
    expect(isWorktreeCommand("ls -la")).toBe(false);
    expect(isWorktreeCommand("echo hello")).toBe(false);
  });

  test("blocks with extra whitespace", () => {
    expect(isWorktreeCommand("git  worktree  add ../feature")).toBe(true);
    expect(isWorktreeCommand("  git worktree add ../feature")).toBe(true);
  });

  test("blocks when worktree is part of a larger command chain", () => {
    expect(isWorktreeCommand("cd /tmp && git worktree add ../feature")).toBe(true);
    expect(isWorktreeCommand("git worktree add ../feature && cd ../feature")).toBe(true);
  });

  test("blocks abbreviated path variants", () => {
    expect(isWorktreeCommand("git worktree add -b feature ../feature main")).toBe(true);
    expect(isWorktreeCommand("git worktree add --detach ../feature")).toBe(true);
  });

  test("blocks remove --force", () => {
    expect(isWorktreeCommand("git worktree remove --force ../feature")).toBe(true);
  });

  test("does not match git-worktree (kebab case)", () => {
    expect(isWorktreeCommand("git-worktree add ../feature")).toBe(false);
  });

  test("block message mentions available tools", () => {
    expect(WORKTREE_BLOCK_MESSAGE).toContain("worktrunk_create");
    expect(WORKTREE_BLOCK_MESSAGE).toContain("worktrunk_remove");
  });

  test("does not match git worktree mentioned inside quoted strings", () => {
    expect(isWorktreeCommand('git commit -m "block git worktree add"')).toBe(false);
    expect(isWorktreeCommand("git commit -m 'git worktree remove is bad'")).toBe(false);
  });

  test("still blocks real worktree commands with quotes elsewhere", () => {
    expect(isWorktreeCommand('git worktree add ../feature -b "my branch"')).toBe(true);
  });
});
