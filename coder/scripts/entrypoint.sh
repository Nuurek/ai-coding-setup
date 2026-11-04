#!/usr/bin/env bash
# Outer container entrypoint: start the workspace's own Docker daemon, then run the
# Coder agent init script passed as $1. The agent builds the Dev Container on start,
# so the daemon must be up first.
set -euo pipefail
# Docker creates the shared volume root-owned.
sudo chown coder:coder /shared
sudo sh -c 'dockerd >/var/log/dockerd.log 2>&1 &'
until docker info >/dev/null 2>&1; do sleep 1; done
exec sh -c "$1"
