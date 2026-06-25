---
name: qmd-add
description: Add a new repository to the qmd index
argument-hint: <repo-path>
---

# qmd-add

Add a new repository to the qmd index and update the configuration.

## Arguments

`$ARGUMENTS` — path to the repository (e.g. `~/Repositories/my-repo`)

## Steps

1. **Read config** at `~/.config/qmd/config.yaml` (or `$XDG_CONFIG_HOME/qmd/config.yaml` if set) to understand available masks and existing collections.

2. **Detect file types** in the repo (exclude `.git`, `node_modules`, `vendor`, `.terraform`, `dist`, `__pycache__`):
   ```
   find <repo-path> -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/vendor/*' -not -path '*/.terraform/*' -not -path '*/dist/*' -not -path '*/__pycache__/*' -type f | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -10
   ```

3. **Pick masks** from the config's `masks` section based on the detected file types. Combine multiple atomic masks as needed (e.g. `[python, config, terraform, docs]` for a Python project). Always include `docs`.

4. **Determine the collection name**:
   - Default to the directory basename
   - If that would conflict with an existing collection, prefix with the parent directory name (e.g. `org-repo-name`)

5. **Update `~/.config/qmd/config.yaml`**: Add a new entry under `collections:` with `path`, `name`, and `masks`. Place it in the appropriate section by language group.

6. **Sync, index, and rebuild**:
   ```
   qmd-setup sync && qmd update && qmd embed && qmd-setup regen-scheduler
   ```

7. **Report** the collection name, file count, and masks used.
