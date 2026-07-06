import { test, expect } from "bun:test";
import { formatSidebarRows } from "./sidebar";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

test("empty list returns empty array", () => {
  expect(formatSidebarRows([], "/some/dir")).toEqual([]);
});

test("single entry matching session dir is active", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wt-sidebar-"));
  const list = [{ branch: "main", path: dir, isMain: true }];
  const result = formatSidebarRows(list, dir);
  expect(result).toHaveLength(1);
  expect(result[0].active).toBe(true);
  expect(result[0].basename).toBe(path.basename(dir));
  expect(result[0].isMain).toBe(true);
  expect(result[0].branch).toBe("main");
});

test("multiple entries - only matching session dir is active", () => {
  const dirA = mkdtempSync(path.join(tmpdir(), "wt-a-"));
  const dirB = mkdtempSync(path.join(tmpdir(), "wt-b-"));
  const list = [
    { branch: "a", path: dirA, isMain: false },
    { branch: "b", path: dirB, isMain: false },
  ];
  const result = formatSidebarRows(list, dirB);
  expect(result[0].active).toBe(false);
  expect(result[1].active).toBe(true);
});

test("isMain flag passes through", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wt-main-"));
  const list = [{ branch: "main", path: dir, isMain: true }];
  const result = formatSidebarRows(list, dir);
  expect(result[0].isMain).toBe(true);
});

test("basename is the last path segment", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "repo-feat-a-"));
  const list = [{ branch: "feat-a", path: dir, isMain: false }];
  const result = formatSidebarRows(list, dir);
  expect(result[0].basename).toBe(path.basename(dir));
});

test("path without slashes returns input as basename", () => {
  const list = [{ branch: "x", path: "nodirs", isMain: false }];
  const result = formatSidebarRows(list, "/totally/different");
  expect(result[0].basename).toBe("nodirs");
  expect(result[0].active).toBe(false);
});

test("symlink-active child path resolves to parent worktree", () => {
  const real = mkdtempSync(path.join(tmpdir(), "real-wt-"));
  const alias = path.join(tmpdir(), "alias-wt-" + Date.now());
  writeFileSync(alias, "", { flag: "w" });
  const list = [{ branch: "main", path: real, isMain: true }];
  const result = formatSidebarRows(list, alias);
  expect(result[0].active).toBe(false);
});
