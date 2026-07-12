# npm publish GitHub Workflow

## Purpose
Publish the `@pplante/opencode-worktrunk` package to the npm registry automatically when the version in `package.json` changes on `main`.

## Trigger
- `push` to `main`
- Restricted to changes that touch `package.json` (best-effort via `paths`).

## Workflow Overview
File: `.github/workflows/npm-publish.yml`

Jobs:
1. **version-check** — compare the `version` field in `HEAD` vs `HEAD~1`. If unchanged, skip publish.
2. **publish** — depends on `version-check`; runs only if the version changed.
   - Checkout code
   - Install Bun
   - Install dependencies (`bun install`)
   - Run tests (`bun test`)
   - Set up Node.js with npm registry auth
   - Publish with `npm publish --access public`

## Secrets
- `NPM_TOKEN`: npm automation or publish token with access to publish `@pplante/opencode-worktrunk`.

## Error Handling
- Test failures block publish.
- If publishing fails (e.g., version already exists), the workflow fails and does not auto-retry.
- `--access public` is required because the package name is scoped.

## Out of Scope
- Provenance attestations
- Changelog generation
- Pre-release or canary channels
- Publishing on tags or manual dispatch
