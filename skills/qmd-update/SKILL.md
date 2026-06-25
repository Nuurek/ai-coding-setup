---
name: qmd-update
description: Re-index and update qmd collections and embeddings
---

# qmd update

Re-index all qmd collections and regenerate vector embeddings.

## Steps

1. If the user asks to sync or remove stale collections, run `ai-coding-setup sync --remove` first to add new collections and remove ones not in config
2. Run `qmd update --pull` to git pull all repos and re-index changed files
3. Run `qmd embed` to regenerate vector embeddings for any new/changed documents
4. Run `qmd status` and report a summary to the user (total files, collections, pending embeddings)

If the user passes arguments like `$ARGUMENTS`, treat them as flags to pass to `qmd update` (e.g. `--pull`).

If no arguments are provided, run `qmd update` without `--pull`.
