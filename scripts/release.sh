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

# Require git-cliff
if ! command -v git-cliff &>/dev/null; then
  echo "Error: git-cliff not found. Install it: https://git-cliff.org/docs/installation"
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

# Generate CHANGELOG.md via git-cliff.
# --tag treats unreleased commits since the last tag as VERSION;
# -o rewrites the whole file per cliff.toml (header/body/footer).
echo "Generating CHANGELOG.md via git-cliff..."
git-cliff --tag "$TAG" -o "$CHANGELOG"

if ! grep -q "## \[$VERSION\]" "$CHANGELOG"; then
  echo "Warning: git-cliff did not generate a section for $VERSION (no commits since last tag?)"
fi
echo "CHANGELOG.md updated"

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
