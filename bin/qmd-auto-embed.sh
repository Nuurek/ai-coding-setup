#!/bin/bash
# qmd-auto-embed: re-index changed collections and regenerate embeddings
# Triggered by launchd when .git/refs change in any watched repo

# launchd / systemd uses minimal PATH — build a useful one dynamically

# System paths (Linux)
for sys_bin in /usr/bin /usr/local/bin /snap/bin; do
  [ -d "$sys_bin" ] && export PATH="$sys_bin:$PATH"
done

# Homebrew (macOS: Apple Silicon and Intel)
for brew_prefix in /opt/homebrew /usr/local; do
  [ -d "$brew_prefix/bin" ] && export PATH="$brew_prefix/bin:$PATH"
done

# Bun
[ -d "$HOME/.bun/bin" ] && export PATH="$HOME/.bun/bin:$PATH"

# mise
[ -d "$HOME/.local/share/mise/installs/node/latest/bin" ] && \
  export PATH="$HOME/.local/share/mise/installs/node/latest/bin:$PATH"

# asdf
[ -d "$HOME/.asdf/shims" ] && export PATH="$HOME/.asdf/shims:$PATH"

# nvm — find the latest installed version dynamically
if [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_DIR=$(ls -1d "$HOME/.nvm/versions/node"/v* 2>/dev/null | sort -V | tail -1)
  [ -n "$NODE_DIR" ] && export PATH="$NODE_DIR/bin:$PATH"
fi

# User local bin
export PATH="$HOME/.local/bin:$PATH"

# Strip terminal progress bars and OSC escape sequences from qmd output
strip_progress() {
  tr '\r' '\n' | grep -vE '^Indexing:|]9;|^[[:space:]]*$'
}

echo "--- $(date '+%Y-%m-%d %H:%M:%S') ---"
qmd update 2>&1 | strip_progress
qmd embed 2>&1 | strip_progress
echo "done"
