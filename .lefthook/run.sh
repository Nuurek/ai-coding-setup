#!/usr/bin/env bash
# Run `lefthook run "$@"` in the lint image, so the host, the Dev Container and CI need only
# Docker. biome is pinned to the version in package-lock.json.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
biome=$(sed -n '/"node_modules\/@biomejs\/biome": {/,/"version"/ s/.*"version": "\(.*\)".*/\1/p' package-lock.json)
docker build -q -t ai-coding-setup-lint --build-arg BIOME_VERSION="$biome" .lefthook >/dev/null
# From a Dev Container the daemon runs outside it and sees the repo at LOCAL_WORKSPACE_FOLDER.
exec docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
  -v "${LOCAL_WORKSPACE_FOLDER:-$PWD}:$PWD" -w "$PWD" \
  ai-coding-setup-lint lefthook run "$@"
