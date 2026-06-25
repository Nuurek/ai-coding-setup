# qmd-setup

CLI tool that manages [qmd](https://github.com/tobilu/qmd) collections, auto-indexing, and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) integration.

## What it does

- **Syncs collections** — reads a YAML config and registers repos with qmd
- **Auto-indexes** — installs a file-watcher that re-indexes and re-embeds when `.git/logs/HEAD` changes in any watched repo (launchd on macOS, systemd on Linux)
- **Claude Code integration** — symlinks rules and skills into `~/.claude/` and merges the qmd MCP server into `~/.claude.json`

## Prerequisites

- **Node.js >= 22**
- **npm** or **bun**
- **qmd** (installed automatically if missing)
- macOS or Linux (Ubuntu/Debian)

## Install

```bash
git clone <repo-url> && cd qmd-setup
./setup
```

The `setup` script:
1. Finds a suitable Node.js (>= 22)
2. Installs `qmd` globally if not present
3. Installs npm dependencies and compiles TypeScript
4. Runs `npm link` to make `qmd-setup` available on PATH
5. Executes the full setup flow (symlinks, MCP config, collection sync, scheduler)

## Configuration

Config lives at `~/.config/qmd/config.yaml` (or `$XDG_CONFIG_HOME/qmd/config.yaml`). See [config.example.yaml](config.example.yaml) for the full format.

```yaml
masks:
  docs: [md, sh]
  python: [py]
  config: [yaml, yml, json, toml]

# macOS only — ignored on Linux (systemd path units debounce automatically)
launchd:
  throttle_interval: 30  # seconds between re-index triggers

collections:
  - path: ~/Repositories/my-project
    name: my-project
    masks: [python, config, docs]
```

**masks** — named file-extension profiles, combined into glob patterns for qmd.

**collections** — repos to index. `path` is required (`~` expanded to `$HOME`), `name` defaults to the directory basename, `masks` selects which file types to include.

Override config path with `-c` / `--config` on any command.

## Usage

```bash
# Full setup (symlinks, MCP config, sync, scheduler)
qmd-setup

# Sync collections from config into qmd
qmd-setup sync

# Sync and remove collections not in config
qmd-setup sync --remove

# Regenerate file-watcher from config (auto-detects platform)
qmd-setup regen-scheduler

# Use a custom config file
qmd-setup -c /path/to/config.yaml sync
```

## How auto-indexing works

The watcher fires when `.git/logs/HEAD` changes in a configured collection. This covers commits, branch checkouts, resets, merges, rebases, and pulls on the current branch — the operations that actually change the on-disk working tree. Fetch-only operations that update remote-tracking branches are intentionally not triggered (no file change on disk).

### macOS (launchd)

`qmd-setup regen-scheduler` writes `~/Library/LaunchAgents/com.qmd.auto-embed.plist` and loads it with `launchctl`. Triggers are throttled (default: 30s, configurable via `launchd.throttle_interval`).

### Linux (systemd)

`qmd-setup regen-scheduler` writes two systemd user units:

- `~/.config/systemd/user/qmd-auto-embed.service` — runs `qmd-auto-embed.sh`
- `~/.config/systemd/user/qmd-auto-embed.path` — watches `.git/logs/HEAD` in each collection

Then runs `systemctl --user daemon-reload && systemctl --user enable --now qmd-auto-embed.path`.

### The trigger script

Both platforms run `~/.local/bin/qmd-auto-embed.sh`:

```
qmd update   # re-index changed collections
qmd embed    # regenerate vector embeddings
```

Logs go to `~/.local/log/qmd-auto-embed.log`.

## Claude Code integration

The setup flow:
- Symlinks `rules/` → `~/.claude/rules/` (global rules for all projects)
- Symlinks `skills/` → `~/.claude/skills/` (slash commands: `/qmd-update`, `/qmd-add`)
- Merges the qmd MCP server config into `~/.claude.json`

This gives Claude Code automatic access to qmd search across all indexed repositories.

## Development

```bash
npm run build     # compile TypeScript
npm test          # compile + run tests
npm run lint      # biome check
npm run format    # biome format
```

Tests use Node's built-in `node:test` runner with `--experimental-test-module-mocks`.
