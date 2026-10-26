#!/usr/bin/env bash
# Runs this package's test suite against a specific Vendure release, in an isolated
# directory outside the monorepo (the workspace root pins @vendure/core via `overrides`).
#
#   ./scripts/test-against-vendure.sh 3.8.0
#   TEST_DB=postgres PGUSER=... PGPASSWORD=... ./scripts/test-against-vendure.sh 3.8.0
#   ES_PLUGIN_VERSION=2.0.0 ELASTICSEARCH_PORT=9209 ./scripts/test-against-vendure.sh 3.8.0
set -euo pipefail

VERSION="${1:?usage: test-against-vendure.sh <vendure-version>}"
PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="${COMPAT_DIR:-$(mktemp -d)}/vendure-$VERSION"
mkdir -p "$WORK_DIR"

rsync -a --delete --exclude node_modules --exclude dist --exclude 'e2e/__data__' \
  "$PKG_DIR/src" "$PKG_DIR/e2e" "$PKG_DIR/vitest.config.mts" "$WORK_DIR/"
cp "$PKG_DIR/../../tsconfig.base.json" "$WORK_DIR/tsconfig.base.json"
sed 's#../../tsconfig.base.json#./tsconfig.base.json#' "$PKG_DIR/tsconfig.json" > "$WORK_DIR/tsconfig.json"

cat > "$WORK_DIR/package.json" <<JSON
{
  "name": "compat-vendure-$VERSION",
  "private": true,
  "dependencies": {
    "@vendure/core": "$VERSION",
    "@vendure/common": "$VERSION",
    "@vendure/testing": "$VERSION",
    "@vendure-community/elasticsearch-plugin": "${ES_PLUGIN_VERSION:-1.1.0}",
    "@elastic/elasticsearch": "^9.1.0",
    "graphql-tag": "^2.12.6",
    "pg": "^8.13.0",
    "sql.js": "^1.13.0"
  },
  "devDependencies": {
    "@swc/core": "^1.13.5",
    "@types/node": "^22.0.0",
    "typescript": "5.8.2",
    "unplugin-swc": "^1.5.7",
    "vitest": "^3.2.4"
  }
}
JSON

cd "$WORK_DIR"
echo "Installing Vendure $VERSION in $WORK_DIR"
npm install --no-audit --no-fund --loglevel=error
if [ -n "${ELASTICSEARCH_PORT:-}" ]; then
  # The Elasticsearch plugin imports @nestjs/terminus, which Vendure 3.8 no longer ships;
  # it only installs next to 3.8 with --legacy-peer-deps.
  npm install --no-save --no-audit --no-fund --loglevel=error --legacy-peer-deps "@nestjs/terminus@^11.0.0"
fi
echo "Installed: $(node -p "require('@vendure/core/package.json').version")"
npx tsc -p tsconfig.json --noEmit
npx vitest run
