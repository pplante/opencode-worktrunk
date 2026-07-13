# Changelog

## [Unreleased]

## [0.2.5] - 2026-07-12

]0;opencode-wt: ready]0;opencode-wt: ready]0;opencode-wt: working]0;● opencode-wt: error]0;● opencode-wt: done

## [0.2.4] - 2026-07-07

]0;opencode-wt: ready]0;opencode-wt: ready]0;opencode-wt: working]0;● opencode-wt: error]0;● opencode-wt: done

## [0.2.3] - 2026-07-07

]0;opencode-wt: ready]0;opencode-wt: ready]0;opencode-wt: working]0;● opencode-wt: error]0;● opencode-wt: done

## [0.2.2] - 2026-07-07

### Added

- Release script (`scripts/release.sh`) with `opencode run` for changelog generation.

## [0.2.1] - 2026-07-07

### Fixed

- Repo name changed to `opencode-worktrunk` across all files.

### Documentation

- CHANGELOG.md added.
- Published to npm.

## [0.2.0] - 2026-07-07

### Added

- `worktrunk-sidebar` TUI plugin: renders worktree list in opencode sidebar with active/inactive bullets, polls every 10s, refreshes on session change.
- `formatSidebarRows` pure helper for sidebar rendering.
- Commit message generation via `opencode run` in release script.

### Fixed

- TUI plugin module `id` field required for file-based loader.

## [0.1.0] - 2026-07-07

### Added

- `worktrunk-wt` server plugin: 5 tools (create, switch, list, merge, remove) and 3 hooks (session.updated, session.directory, permission.ask).
- `buildListArgs`, `parseListResult`, `parseSwitchResult`, `resolvePath`, `isUnderPath` pure helpers with tests.
- Per-session state tracking for repository root.

### Fixed

- Error context attached to `wt` JSON parse and session rebind failures.

### Documentation

- README with install, architecture, and usage instructions.
- AGENTS.md with development commands and conventions.
- Design spec and implementation plan for all features.
