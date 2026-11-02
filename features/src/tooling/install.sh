#!/usr/bin/env bash
# Image-build half of the feature (runs as root): installs everything that is
# user-independent. Per-user setup (~/.claude, qmd config, index, watcher) runs
# later from the lifecycle hooks via ai-coding-setup-init.
set -euo pipefail

QMD_CONFIG="${QMDCONFIG:-.devcontainer/qmd-config.yaml}"
RTK_VERSION="${RTKVERSION:-v0.42.4}"

PREFIX="/usr/local/share/ai-coding-setup"
FEATURE_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$FEATURE_DIR/bundle/dist/setup.js" ]; then
  echo "ERROR: bundle/ missing; run features/bundle.sh before packaging" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node >= 22 not found; add ghcr.io/devcontainers/features/node" >&2
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "ERROR: node >= 22 required, found $(node --version)" >&2
  exit 1
fi

echo "--- System packages ---"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# inotify-tools: the watcher used when systemd is absent (always, in a container).
apt-get install -y --no-install-recommends ca-certificates curl inotify-tools
rm -rf /var/lib/apt/lists/*

echo "--- ai-coding-setup ---"
# Code ships inside the Feature (staged by features/bundle.sh), so the image
# build needs no access to the repo and the Feature version pins the code.
rm -rf "$PREFIX"
cp -R "$FEATURE_DIR/bundle" "$PREFIX"
# --ignore-scripts: the root "prepare" script needs a git checkout; the runtime
# deps (commander, mustache, yaml) have no install scripts of their own.
(cd "$PREFIX" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
ln -sf "$PREFIX/dist/setup.js" /usr/local/bin/ai-coding-setup

echo "--- qmd ---"
npm install -g --no-audit --no-fund @tobilu/qmd
# better-sqlite3 resolves its binding lazily, so construct a Database to prove it loads.
QMD_DIR="$(npm root -g)/@tobilu/qmd"
if ! (cd "$QMD_DIR" && node -e "new (require('better-sqlite3'))(':memory:').close()") 2>/dev/null; then
  echo "  rebuilding better-sqlite3 binding"
  (cd "$QMD_DIR" && npm rebuild better-sqlite3)
  (cd "$QMD_DIR" && node -e "new (require('better-sqlite3'))(':memory:').close()")
fi

echo "--- rtk ${RTK_VERSION} ---"
curl -fsSL "https://raw.githubusercontent.com/rtk-ai/rtk/${RTK_VERSION}/install.sh" \
  | RTK_VERSION="$RTK_VERSION" RTK_INSTALL_DIR=/usr/local/bin sh

echo "--- User state dirs ---"
# Pre-create them owned by the remote user: a fresh named volume mounted here
# copies this ownership, instead of Docker creating the mount point as root.
REMOTE_USER="${_REMOTE_USER:-vscode}"
REMOTE_HOME="${_REMOTE_USER_HOME:-/home/$REMOTE_USER}"
if id "$REMOTE_USER" >/dev/null 2>&1; then
  install -d -o "$REMOTE_USER" -g "$REMOTE_USER" "$REMOTE_HOME/.cache" \
    "$REMOTE_HOME/.cache/qmd" "$REMOTE_HOME/.claude"
fi

echo "--- Lifecycle entry point ---"
install -d /usr/local/etc/ai-coding-setup
printf 'QMD_CONFIG=%q\n' "$QMD_CONFIG" > /usr/local/etc/ai-coding-setup/feature.env
install -m 0755 "$FEATURE_DIR/ai-coding-setup-init" /usr/local/bin/ai-coding-setup-init

echo "ai-coding-setup tooling installed"
