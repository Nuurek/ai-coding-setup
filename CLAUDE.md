# ai-coding-setup

CLI tool that manages [qmd](https://github.com/tobilu/qmd) collections, auto-indexing (launchd on macOS, systemd on Linux), and Claude Code integration.

**Important:** After making changes, review this file and update it if your changes affect structure, commands, patterns, or conventions documented here.

## Quick reference

```bash
npm test                        # compile + run all tests
npm run build                   # compile TypeScript only
npm run lint                    # biome check
npm run format                  # biome check --write
ai-coding-setup                      # full setup (symlinks, MCP, status line, sync, index, scheduler)
ai-coding-setup sync                 # add collections from config to qmd
ai-coding-setup sync --remove        # add + remove collections not in config
ai-coding-setup regen-scheduler        # regenerate file-watcher (auto-detects platform)
ai-coding-setup -c path/to/config.yaml sync  # use custom config
```

## Project structure

```
src/
  setup.ts              # CLI entry point (commander), main setup flow, MCP config merge, status-line merge
  setup.test.ts         # tests for mergeMcpConfig, mergeStatusLine, resolveConfigPath
  sync-collections.ts   # collection sync logic, types (Config, Collection), helpers
  sync-collections.test.ts  # tests for expandHome, buildGlob, parseCollectionNames
  scheduler.ts          # platform dispatch (darwin->launchd, linux->systemd)
  regen-plist.ts        # launchd plist generation (Mustache), extractWatchPaths
  regen-plist.test.ts   # tests for buildPlistXml, extractWatchPaths (mocked fs)
  regen-systemd.ts      # systemd service+path unit generation (Mustache)
  regen-systemd.test.ts # tests for buildServiceUnit, buildPathUnit
templates/
  launchd-plist.mustache    # Mustache template for launchd plist (macOS)
  systemd-service.mustache  # Mustache template for systemd service unit (Linux)
  systemd-path.mustache     # Mustache template for systemd path unit (Linux)
bin/
  qmd-auto-embed.sh    # shell script triggered by launchd/systemd (qmd update + embed)
fragments/
  mcp-server.json       # MCP server config fragment injected into ~/.claude.json
  status-line.json      # statusLine block merged into ~/.claude/settings.json
skills/                 # Claude Code skills (symlinked to ~/.claude/skills/)
rules/                  # Claude Code rules (symlinked to ~/.claude/rules/)
config.example.yaml     # example config for new users
setup                   # bootstrap script (finds node, installs deps, runs setup)
```

## Config

Location: `~/.config/qmd/config.yaml` (or `$XDG_CONFIG_HOME/qmd/config.yaml`)

Override with `-c` / `--config` flag on any command.

Types are defined in `sync-collections.ts`: `Config`, `Collection`, `LaunchdConfig`.

## Tech stack

- **TypeScript** (ES2022, NodeNext modules) — compiled to `dist/`
- **Node.js >= 22** — required for `node:test` module mocking
- **Biome** — linting and formatting (double quotes, semicolons, 2-space indent, 100 line width)
- **lint-staged** — pre-commit hook via `.githooks/pre-commit`
- **Commander.js** — CLI argument parsing
- **Mustache** — template rendering (plist/systemd unit generation). Uses triple-mustache `{{{var}}}` for filesystem paths (no HTML escaping)
- **yaml** — config file parsing

## Testing

Tests use Node's built-in `node:test` runner with `--experimental-test-module-mocks`.

`regen-plist.test.ts` mocks `existsSync` via a mutable proxy pattern:
```typescript
let existsFn = realFs.existsSync;
mock.module("node:fs", {
  namedExports: { ...realFs, existsSync: (p: string) => existsFn(p) },
});
```
Tests swap `existsFn` to control filesystem behavior, restored in `afterEach`.

## Key patterns

- **`REPO_DIR`**: `resolve(dirname(fileURLToPath(import.meta.url)), "..")` — used to locate templates, fragments, and bin scripts at runtime
- **`expandHome`**: replaces leading `~` with `homedir()` — used for all config paths
- **Config closure in CLI**: `const configPath = () => resolveConfigPath(program.opts().config)` — deferred because `program.opts()` is only populated after `program.parse()`
