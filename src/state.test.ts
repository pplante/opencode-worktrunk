import { test, expect } from "bun:test";
import { createState } from "./state";

test("set and get", () => {
  const state = createState();
  state.set("s1", { worktreePath: "/a", branch: "main" });
  expect(state.get("s1")).toEqual({ worktreePath: "/a", branch: "main" });
});

test("get returns undefined for unknown session", () => {
  const state = createState();
  expect(state.get("unknown")).toBeUndefined();
});

test("clear removes entry", () => {
  const state = createState();
  state.set("s1", { worktreePath: "/a", branch: "main" });
  state.clear("s1");
  expect(state.get("s1")).toBeUndefined();
});

test("sessions are isolated", () => {
  const state = createState();
  state.set("s1", { worktreePath: "/a", branch: "main" });
  state.set("s2", { worktreePath: "/b", branch: "feat" });
  expect(state.get("s1")?.branch).toBe("main");
  expect(state.get("s2")?.branch).toBe("feat");
  state.clear("s1");
  expect(state.get("s1")).toBeUndefined();
  expect(state.get("s2")?.branch).toBe("feat");
});

test("each createState call is independent", () => {
  const s1 = createState();
  const s2 = createState();
  s1.set("x", { worktreePath: "/a", branch: "main" });
  expect(s2.get("x")).toBeUndefined();
});
