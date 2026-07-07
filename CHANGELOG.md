# Changelog

## [Unreleased]

## [0.2.0] - 2026-07-07

]0;opencode-wt: ready]0;opencode-wt: ready]0;opencode-wt: working]0;● opencode-wt: error]0;● opencode-wt: done

### Added

- CHANGELOG.md tracking.

## [0.1.0] - 2026-07-07

### Added

- `worktrunk-wt` server plugin: 5 tools (create, switch, list, merge, remove) and 3 hooks (session.updated, session.directory, permission.ask).
- `worktrunk-sidebar` TUI plugin: renders worktree list in opencode sidebar with active/inactive bullets, polls every 10s, refreshes on session change.
- `formatSidebarRows`, `buildListArgs`, `parseListResult`, `parseSwitchResult`, `resolvePath`, `isUnderPath` pure helpers with tests.
- Per-session state tracking for repository root.

### Fixed

- `id` field required in TUI plugin module for file-based loader.
- Error context attached to `wt` JSON parse and session rebind failures.

### Documentation

- README with install, architecture, and usage instructions.
- AGENTS.md with development commands and conventions.
- Design spec and implementation plan for all features.
