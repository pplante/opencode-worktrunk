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

test("parseSwitchResult - invalid json throws descriptive error", () => {
  expect(() => parseSwitchResult("not json")).toThrow(
    "parseSwitchResult failed"
  );
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
