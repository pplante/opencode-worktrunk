import { describe, expect, test } from "bun:test";
import { buildBootstrap, BOOTSTRAP_SENTINEL } from "./bootstrap";

describe("buildBootstrap", () => {
  const content = buildBootstrap();

  test("wraps in EXTREMELY_IMPORTANT tags", () => {
    expect(content.startsWith("<EXTREMELY_IMPORTANT>")).toBe(true);
    expect(content.endsWith("</EXTREMELY_IMPORTANT>")).toBe(true);
  });

  test("contains the sentinel for double-injection guard", () => {
    expect(content).toContain(BOOTSTRAP_SENTINEL);
  });

  test("mentions all five worktrunk tools", () => {
    expect(content).toContain("worktrunk_create");
    expect(content).toContain("worktrunk_switch");
    expect(content).toContain("worktrunk_list");
    expect(content).toContain("worktrunk_merge");
    expect(content).toContain("worktrunk_remove");
  });

  test("states the always-worktree rule", () => {
    expect(content).toMatch(/always/i);
    expect(content).toMatch(/worktree.*main/i);
  });

  test("warns against direct git worktree commands", () => {
    expect(content).toMatch(/git worktree.*blocked/i);
  });

  test("warns against passing --yes for hook approvals", () => {
    expect(content).toContain("--yes");
    expect(content).toContain("wt config approvals add");
  });

  test("warns about bash workdir caveat", () => {
    expect(content).toMatch(/absolute path/i);
    expect(content).toContain("workdir");
  });
});
