import { test, expect } from "bun:test";
import { isUnderPath } from "./paths";

test("child is under parent", () => {
  expect(isUnderPath("/a/b/c", "/a/b")).toBe(true);
});

test("same path is under itself", () => {
  expect(isUnderPath("/a/b", "/a/b")).toBe(true);
});

test("sibling is not under parent", () => {
  expect(isUnderPath("/a/bd", "/a/b")).toBe(false);
});

test("parent is not under child", () => {
  expect(isUnderPath("/a/b", "/a/b/c")).toBe(false);
});

test("unrelated path", () => {
  expect(isUnderPath("/x/y", "/a/b")).toBe(false);
});
