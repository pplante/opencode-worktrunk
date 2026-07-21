import { test, expect } from "bun:test";
import {
  parseAliasShow,
  buildAliasArgs,
  sanitizeAliasToolName,
  summarizeAliasTemplate,
} from "./aliases";

const TWO_ALIASES = `○ Alias deploy (user):
  fly deploy --app=myapp-{{ branch }}
○ Alias since-main (user):
  git log --oneline {{ default_branch }}..HEAD`;

const PIPELINE_ALIAS = `○ Alias release (user):
  # test
  cargo test
  # build
  cargo build --release`;

const PROJECT_SOURCE = `○ Alias deploy (project):
  fly deploy --config=fly.{{ env }}.toml`;

const NO_ALIASES = `○ No aliases configured
`;

test("parseAliasShow - empty when no aliases configured", () => {
  expect(parseAliasShow(NO_ALIASES)).toEqual([]);
});

test("parseAliasShow - empty string", () => {
  expect(parseAliasShow("")).toEqual([]);
});

test("parseAliasShow - parses two single-line aliases", () => {
  const result = parseAliasShow(TWO_ALIASES);
  expect(result).toEqual([
    {
      name: "deploy",
      source: "user",
      template: "fly deploy --app=myapp-{{ branch }}",
    },
    {
      name: "since-main",
      source: "user",
      template: "git log --oneline {{ default_branch }}..HEAD",
    },
  ]);
});

test("parseAliasShow - parses hyphenated alias name", () => {
  const result = parseAliasShow(TWO_ALIASES);
  expect(result[1].name).toBe("since-main");
});

test("parseAliasShow - parses multi-step pipeline template", () => {
  const result = parseAliasShow(PIPELINE_ALIAS);
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("release");
  expect(result[0].source).toBe("user");
  expect(result[0].template).toBe("# test\ncargo test\n# build\ncargo build --release");
});

test("parseAliasShow - captures project source", () => {
  const result = parseAliasShow(PROJECT_SOURCE);
  expect(result[0].source).toBe("project");
  expect(result[0].name).toBe("deploy");
});

test("parseAliasShow - trims trailing whitespace from template", () => {
  const stdout = `○ Alias deploy (user):
  fly deploy   `;
  expect(parseAliasShow(stdout)[0].template).toBe("fly deploy");
});

test("parseAliasShow - ignores non-indented non-header lines", () => {
  const stdout = `intro banner line
○ Alias deploy (user):
  fly deploy
stray line`;
  const result = parseAliasShow(stdout);
  expect(result).toHaveLength(1);
  expect(result[0].template).toBe("fly deploy");
});

test("parseAliasShow - handles CRLF line endings", () => {
  const stdout = TWO_ALIASES.replace(/\n/g, "\r\n");
  const result = parseAliasShow(stdout);
  expect(result).toHaveLength(2);
  expect(result[0].name).toBe("deploy");
});

test("buildAliasArgs - name only", () => {
  expect(buildAliasArgs("deploy")).toEqual(["deploy"]);
});

test("buildAliasArgs - forwards positional args", () => {
  expect(buildAliasArgs("s", ["feature/api"])).toEqual(["s", "feature/api"]);
});

test("buildAliasArgs - forwards key=value flags and positionals", () => {
  expect(buildAliasArgs("deploy", ["--env=staging", "extra"])).toEqual([
    "deploy",
    "--env=staging",
    "extra",
  ]);
});

test("buildAliasArgs - empty args array forwards name only", () => {
  expect(buildAliasArgs("open", [])).toEqual(["open"]);
});

test("buildAliasArgs - does not inject -y or --format", () => {
  const result = buildAliasArgs("deploy", ["--env=prod"]);
  expect(result).not.toContain("-y");
  expect(result).not.toContain("--yes");
  expect(result.some((a) => a.startsWith("--format"))).toBe(false);
});

test("sanitizeAliasToolName - simple name", () => {
  expect(sanitizeAliasToolName("deploy")).toBe("worktrunk_alias_deploy");
});

test("sanitizeAliasToolName - hyphenated name", () => {
  expect(sanitizeAliasToolName("since-main")).toBe("worktrunk_alias_since_main");
});

test("sanitizeAliasToolName - collapses non-alphanumeric runs", () => {
  expect(sanitizeAliasToolName("foo.bar_baz")).toBe("worktrunk_alias_foo_bar_baz");
});

test("sanitizeAliasToolName - prefixed consistently", () => {
  expect(sanitizeAliasToolName("up")).toMatch(/^worktrunk_alias_/);
});

test("summarizeAliasTemplate - collapses whitespace", () => {
  expect(summarizeAliasTemplate("# test\ncargo test\n# build\ncargo build")).toBe(
    "# test cargo test # build cargo build",
  );
});

test("summarizeAliasTemplate - truncates long templates", () => {
  const long = "git log " + "x ".repeat(200);
  const summary = summarizeAliasTemplate(long, 40);
  expect(summary.length).toBeLessThanOrEqual(41);
  expect(summary.endsWith("…")).toBe(true);
});
