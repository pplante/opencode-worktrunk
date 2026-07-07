#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <version>"
  echo "  e.g. $0 0.2.0"
  exit 1
fi

VERSION="$1"
PACKAGE_JSON="package.json"
CHANGELOG="CHANGELOG.md"

# Validate semver (basic)
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  echo "Error: '$VERSION' is not a valid semver (e.g. 0.2.0, 0.2.0-rc1)"
  exit 1
fi

TAG="v$VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists"
  exit 1
fi

# Bump version in package.json
python3 -c "
import json
p = json.load(open('$PACKAGE_JSON'))
p['version'] = '$VERSION'
json.dump(p, open('$PACKAGE_JSON', 'w'), indent=2)
print(p.get('name', '<unknown>') + ': ' + '$VERSION')
"

# Build commit log since last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [ -n "$LAST_TAG" ]; then
  COMMITS=$(git log --oneline --no-decorate "$LAST_TAG"..HEAD)
else
  COMMITS=$(git log --oneline --no-decorate)
  LAST_TAG="(initial)"
fi

echo "Found $LAST_TAG..HEAD ($(echo "$COMMITS" | wc -l | tr -d ' ') commits)"

# Generate changelog entry via opencode
DATE=$(date +%Y-%m-%d)
ENTRY_FILE=$(mktemp)
trap 'rm -f "$ENTRY_FILE"' EXIT

if command -v opencode &>/dev/null; then
  echo "Generating changelog via 'opencode run'..."
  opencode run \
    "Generate a CHANGELOG.md entry for version $VERSION (released $DATE).
Analyze these git commits and categorize under: Added, Fixed, Changed, Deprecated, Removed, Security, Documentation.
Use markdown bullet format with short descriptions.
Output ONLY the section body (### headings + bullets), not the version heading and not the 'Unreleased' section.
Be concise — one line per change. Here are the commits between $LAST_TAG and HEAD:

$COMMITS" > "$ENTRY_FILE" 2>/dev/null || true
fi

ENTRY=$(cat "$ENTRY_FILE")
if [ -z "$ENTRY" ]; then
  echo "opencode run unavailable or returned empty — using placeholder entry."
  ENTRY="### Added

- (fill me)

### Fixed

- (fill me)"
fi

# Insert into CHANGELOG.md
python3 << PYEOF
with open("$CHANGELOG") as f:
    content = f.read()

header = '# Changelog\n\n## [Unreleased]\n\n'
if not content.startswith(header):
    print('Error: expected Unreleased section at top of CHANGELOG.md')
    exit(1)

# Read entry from temp file
with open("$ENTRY_FILE") as f:
    entry = f.read().strip()

new_section = f'## [$VERSION] - $DATE\n\n{entry}\n\n'
rest = content[len(header):]
new_content = header + new_section + rest

with open("$CHANGELOG", 'w') as f:
    f.write(new_content)
print('CHANGELOG.md updated')
PYEOF

echo "---"
echo "Releasing $TAG"
echo "---"
echo ""

# Commit all changes
git add -A
git commit -m "release: $TAG"

# Tag
git tag "$TAG"

# Publish to npm
npm publish --access public

# Push
git push origin main --follow-tags

echo ""
echo "Done: $TAG published and pushed."
