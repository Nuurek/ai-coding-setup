#!/usr/bin/env bash
# Dev Container agent script: put a `gh` wrapper first on PATH that authenticates
# with Coder's GitHub external auth token, fetched per call so it never goes stale.
set -euo pipefail

cat >"$CODER_SCRIPT_BIN_DIR/gh" <<'EOF'
#!/usr/bin/env bash
dir=$(dirname "$0")
real=$(PATH=${PATH//"$dir:"/} command -v gh) || { echo "gh: not installed in this container" >&2; exit 127; }
token=$(coder external-auth access-token github 2>/dev/null) && export GH_TOKEN="$token"
exec "$real" "$@"
EOF
chmod +x "$CODER_SCRIPT_BIN_DIR/gh"
