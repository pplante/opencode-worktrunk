import { test, expect } from "bun:test";
import { formatSidebarRows, statusIcon, partitionRows } from "./sidebar";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

test("empty list returns empty array", () => {
  expect(formatSidebarRows([], "/some/dir")).toEqual([]);
});

test("single entry matching session dir is active", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wt-sidebar-"));
  const list = [
    {
      branch: "main",
      path: dir,
      isMain: true,
      isCurrent: true,
      isPrevious: false,
      ahead: 0,
      behind: 0,
      dirty: false,
    },
  ];
  const result = formatSidebarRows(list, dir);
  expect(result).toHaveLength(1);
  expect(result[0].active).toBe(true);
  expect(result[0].isMain).toBe(true);
  expect(result[0].branch).toBe("main");
});

test("multiple entries - only matching session dir is active", () => {
  const dirA = mkdtempSync(path.join(tmpdir(), "wt-a-"));
  const dirB = mkdtempSync(path.join(tmpdir(), "wt-b-"));
  const list = [
    {
      branch: "a",
      path: dirA,
      isMain: false,
      isCurrent: false,
      isPrevious: false,
      ahead: 0,
      behind: 0,
      dirty: false,
    },
    {
      branch: "b",
      path: dirB,
      isMain: false,
      isCurrent: true,
      isPrevious: false,
      ahead: 0,
      behind: 0,
      dirty: false,
    },
  ];
  const result = formatSidebarRows(list, dirB);
  expect(result[0].active).toBe(false);
  expect(result[1].active).toBe(true);
});

test("isMain flag passes through", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wt-main-"));
  const list = [
    {
      branch: "main",
      path: dir,
      isMain: true,
      isCurrent: true,
      isPrevious: false,
      ahead: 0,
      behind: 0,
      dirty: false,
    },
  ];
  const result = formatSidebarRows(list, dir);
  expect(result[0].isMain).toBe(true);
});

test("symlink-active child path resolves to parent worktree", () => {
  const real = mkdtempSync(path.join(tmpdir(), "real-wt-"));
  const alias = path.join(tmpdir(), "alias-wt-" + Date.now());
  writeFileSync(alias, "", { flag: "w" });
  const list = [
    {
      branch: "main",
      path: real,
      isMain: true,
      isCurrent: false,
      isPrevious: false,
      ahead: 0,
      behind: 0,
      dirty: false,
    },
  ];
  const result = formatSidebarRows(list, alias);
  expect(result[0].active).toBe(false);
});

test("statusIcon: clean and in-sync returns empty string", () => {
  expect(statusIcon(false, 0, 0, false)).toBe("");
});

test("statusIcon: dirty shows *", () => {
  expect(statusIcon(true, 0, 0, false)).toBe("*");
});

test("statusIcon: ahead shows arrow with count", () => {
  expect(statusIcon(false, 3, 0, false)).toBe("↑3");
});

test("statusIcon: behind shows arrow with count", () => {
  expect(statusIcon(false, 0, 2, false)).toBe("↓2");
});

test("statusIcon: integrated shows check", () => {
  expect(statusIcon(false, 0, 0, true)).toBe("✓");
});

test("statusIcon: combined dirty + ahead + integrated", () => {
  expect(statusIcon(true, 3, 0, true)).toBe("* ↑3 ✓");
});

test("statusIcon: dirty + behind, no integrated", () => {
  expect(statusIcon(true, 0, 5, false)).toBe("* ↓5");
});

test("partitionRows: current is the active row", () => {
  const rows = [
    {
      branch: "a",
      path: "/a",
      status: "",
      isMain: false,
      isCurrent: false,
      isPrevious: false,
      active: false,
    },
    {
      branch: "b",
      path: "/b",
      status: "",
      isMain: false,
      isCurrent: true,
      isPrevious: false,
      active: true,
    },
  ];
  const { current, others } = partitionRows(rows);
  expect(current?.branch).toBe("b");
  expect(others).toHaveLength(1);
  expect(others[0].branch).toBe("a");
});

test("partitionRows: falls back to isCurrent when none active", () => {
  const rows = [
    {
      branch: "a",
      path: "/a",
      status: "",
      isMain: false,
      isCurrent: true,
      isPrevious: false,
      active: false,
    },
    {
      branch: "b",
      path: "/b",
      status: "",
      isMain: false,
      isCurrent: false,
      isPrevious: false,
      active: false,
    },
  ];
  const { current, others } = partitionRows(rows);
  expect(current?.branch).toBe("a");
  expect(others).toHaveLength(1);
  expect(others[0].branch).toBe("b");
});

test("partitionRows: no current or active returns null current", () => {
  const rows = [
    {
      branch: "a",
      path: "/a",
      status: "",
      isMain: false,
      isCurrent: false,
      isPrevious: false,
      active: false,
    },
  ];
  const { current, others } = partitionRows(rows);
  expect(current).toBeNull();
  expect(others).toHaveLength(1);
});

test("formatSidebarRows status composes dirty + ahead + integrated", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wt-status-"));
  const list = [
    {
      branch: "feat",
      path: dir,
      isMain: false,
      isCurrent: true,
      isPrevious: false,
      ahead: 3,
      behind: 0,
      dirty: true,
      mainState: "integrated",
    },
  ];
  const result = formatSidebarRows(list, dir);
  expect(result).toHaveLength(1);
  expect(result[0].status).toBe("* ↑3 ✓");
  expect(result[0].active).toBe(true);
});

test("formatSidebarRows passes through isPrevious true", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wt-prev-"));
  const list = [
    {
      branch: "x",
      path: dir,
      isMain: false,
      isCurrent: false,
      isPrevious: true,
      ahead: 0,
      behind: 0,
      dirty: false,
    },
  ];
  const result = formatSidebarRows(list, "/totally/different");
  expect(result[0].isPrevious).toBe(true);
});
