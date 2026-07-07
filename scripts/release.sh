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

# Update CHANGELOG.md: insert new version above [Unreleased]
DATE=$(date +%Y-%m-%d)
python3 -c "
import re
with open('$CHANGELOG') as f:
    content = f.read()

# Insert new entry after the header + blank line after 'Unreleased' header
header = '# Changelog\n\n## [Unreleased]\n\n'
entry = '## [$VERSION] - $DATE\n\n### Added\n\n- (fill me)\n\n### Fixed\n\n- (fill me)\n\n'
if not content.startswith(header):
    print('Error: expected Unreleased section at top of CHANGELOG.md')
    exit(1)
rest = content[len(header):]
new_content = header + entry + '\n' + rest
with open('$CHANGELOG', 'w') as f:
    f.write(new_content)
print('CHANGELOG.md updated')
"

# Show what's about to be released
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
