#!/usr/bin/env bash
# Build an encrypted SQLCipher DB of LLM API keys from a gpg-encrypted
# 1Password archive export.
#
#   Decrypt (gpg) -> test & emit SQL (node) -> encrypt (sqlcipher)
#
# Key material and the passphrase only ever travel through the pipe; nothing
# is written to disk in plaintext and nothing is printed to the terminal.
#
# Usage:
#   ./build-db.sh <archive.json.gpg> [out.db]
#
# Passphrase (used for BOTH the gpg archive and the SQLCipher DB) is read from
# the system keyring:  secret-tool lookup service op-vault-archive
set -euo pipefail

ARCHIVE="${1:?usage: build-db.sh <archive.json.gpg> [out.db]}"
OUT="${2:-$HOME/llm-keys.db}"
SERVICE="${SECRET_SERVICE:-op-vault-archive}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v sqlcipher >/dev/null || { echo "sqlcipher not installed (sudo apt install sqlcipher)" >&2; exit 1; }

PASS="$(secret-tool lookup service "$SERVICE")"
[ -n "$PASS" ] || { echo "no passphrase from secret-tool service=$SERVICE" >&2; exit 1; }

rm -f "$OUT"
gpg --batch --pinentry-mode loopback --passphrase-fd 3 -d "$ARCHIVE" \
      3< <(printf '%s' "$PASS") 2>/dev/null \
  | PASS="$PASS" node "$HERE/build-sql.mjs" \
  | sqlcipher "$OUT"

echo "Wrote $OUT" >&2
