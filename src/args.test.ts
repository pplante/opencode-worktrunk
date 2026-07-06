import { test, expect } from "bun:test";
import {
  buildSwitchArgs,
  buildMergeArgs,
  buildListArgs,
  buildRemoveArgs,
} from "./args";

test("buildSwitchArgs - create new branch", () => {
  expect(buildSwitchArgs({ branch: "feat", create: true })).toEqual([
    "switch",
    "--create",
    "--no-cd",
    "--format",
    "json",
    "-y",
    "feat",
  ]);
});

test("buildSwitchArgs - create with base and noHooks", () => {
  expect(
    buildSwitchArgs({
      branch: "feat",
      create: true,
      base: "develop",
      noHooks: true,
    })
  ).toEqual([
    "switch",
    "--create",
    "--base",
    "develop",
    "--no-hooks",
    "--no-cd",
    "--format",
    "json",
    "-y",
    "feat",
  ]);
});

test("buildSwitchArgs - switch to existing", () => {
  expect(buildSwitchArgs({ branch: "main", create: false })).toEqual([
    "switch",
    "--no-cd",
    "--format",
    "json",
    "-y",
    "main",
  ]);
});

test("buildMergeArgs - defaults", () => {
  expect(buildMergeArgs({})).toEqual([
    "merge",
    "--format",
    "json",
    "-y",
  ]);
});

test("buildMergeArgs - all options", () => {
  expect(
    buildMergeArgs({
      target: "develop",
      noRemove: true,
      noSquash: true,
      noHooks: true,
    })
  ).toEqual([
    "merge",
    "--no-remove",
    "--no-squash",
    "--no-hooks",
    "--format",
    "json",
    "-y",
    "develop",
  ]);
});

test("buildListArgs", () => {
  expect(buildListArgs()).toEqual([
    "list",
    "--format",
    "json",
    "-y",
  ]);
});

test("buildRemoveArgs - basic", () => {
  expect(buildRemoveArgs({ branch: "feat" })).toEqual([
    "remove",
    "--format",
    "json",
    "-y",
    "--foreground",
    "feat",
  ]);
});

test("buildRemoveArgs - with noHooks", () => {
  expect(buildRemoveArgs({ branch: "feat", noHooks: true })).toEqual([
    "remove",
    "--no-hooks",
    "--format",
    "json",
    "-y",
    "--foreground",
    "feat",
  ]);
});
