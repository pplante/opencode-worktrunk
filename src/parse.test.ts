import { test, expect } from "bun:test";
import { parseSwitchResult, parseListResult, parseMergeResult, parseRemoveResult } from "./parse";

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
  const json = '{"action":"already_at","branch":"main","path":"/tmp/wt"}';
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
    isCurrent: true,
    isPrevious: false,
    ahead: 0,
    behind: 0,
    dirty: false,
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

test("parseSwitchResult - invalid json throws descriptive error", () => {
  expect(() => parseSwitchResult("not json")).toThrow("parseSwitchResult failed");
  expect(() => parseSwitchResult("not json")).toThrow("raw output");
});

test("parseListResult - invalid json throws descriptive error", () => {
  expect(() => parseListResult("not json")).toThrow("parseListResult failed");
  expect(() => parseListResult("not json")).toThrow("raw output");
});

test("parseMergeResult - invalid json throws descriptive error", () => {
  expect(() => parseMergeResult("not json")).toThrow("parseMergeResult failed");
  expect(() => parseMergeResult("not json")).toThrow("raw output");
});

test("parseRemoveResult - invalid json throws descriptive error", () => {
  expect(() => parseRemoveResult("not json")).toThrow("parseRemoveResult failed");
  expect(() => parseRemoveResult("not json")).toThrow("raw output");
});

test("parse failures include snippet of raw output", () => {
  const raw = "x".repeat(300);
  try {
    parseSwitchResult(raw);
    throw new Error("should have thrown");
  } catch (e: any) {
    expect(e.message).toContain("parseSwitchResult failed");
    expect(e.message).toContain(raw.slice(0, 200));
    expect(e.message.includes("x".repeat(201))).toBe(false);
  }
});

const STATUS_FIXTURE = JSON.stringify([
  {
    branch: "main",
    path: "/repo/main",
    kind: "worktree",
    is_main: true,
    is_current: true,
    is_previous: false,
    main_state: "is_main",
    working_tree: {
      staged: false,
      modified: true,
      untracked: false,
      renamed: false,
      deleted: false,
    },
    remote: { name: "origin", branch: "main", ahead: 3, behind: 0 },
  },
  {
    branch: "feat",
    path: "/repo/feat",
    kind: "worktree",
    is_main: false,
    is_current: false,
    is_previous: true,
    main_state: "integrated",
    integration_reason: "ancestor",
    working_tree: {
      staged: false,
      modified: false,
      untracked: false,
      renamed: false,
      deleted: false,
    },
    main: { ahead: 0, behind: 15 },
  },
]);

test("parseListResult maps status fields to camelCase", () => {
  const rows = parseListResult(STATUS_FIXTURE);
  expect(rows).toHaveLength(2);

  const main = rows[0];
  expect(main.branch).toBe("main");
  expect(main.isMain).toBe(true);
  expect(main.isCurrent).toBe(true);
  expect(main.isPrevious).toBe(false);
  expect(main.mainState).toBe("is_main");
  expect(main.ahead).toBe(3);
  expect(main.behind).toBe(0);
  expect(main.dirty).toBe(true);

  const feat = rows[1];
  expect(feat.isCurrent).toBe(false);
  expect(feat.isPrevious).toBe(true);
  expect(feat.mainState).toBe("integrated");
  expect(feat.ahead).toBe(0);
  expect(feat.behind).toBe(15);
  expect(feat.dirty).toBe(false);
});

test("parseListResult falls back to 0 ahead/behind when neither remote nor main present", () => {
  const minimal = JSON.stringify([{ branch: "x", path: "/x", is_main: false }]);
  const rows = parseListResult(minimal);
  expect(rows[0].ahead).toBe(0);
  expect(rows[0].behind).toBe(0);
  expect(rows[0].dirty).toBe(false);
  expect(rows[0].isCurrent).toBe(false);
});
