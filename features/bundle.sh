#!/usr/bin/env bash
# Builds ai-coding-setup and stages the runtime files into the tooling Feature,
# so the published Feature carries its own copy instead of cloning this repo at
# image build. Run before publishing (CI does) or before testing locally.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_DIR/features/src/tooling/bundle"

cd "$REPO_DIR"
npm ci --no-audit --no-fund
npx tsc

rm -rf "$OUT"
mkdir -p "$OUT"
# Everything the CLI resolves via REPO_DIR at runtime, plus what npm needs to
# install its production dependencies.
cp -R dist bin templates fragments skills rules "$OUT/"
cp config.example.yaml package.json package-lock.json "$OUT/"
rm -f "$OUT"/dist/*.test.js
chmod +x "$OUT/dist/setup.js"

echo "Bundled $(git rev-parse --short HEAD 2>/dev/null || echo 'working tree') into $OUT"
