#!/usr/bin/env node
import { execSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { getScheduler } from "./scheduler.js";
import { syncCollections } from "./sync-collections.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const HOME = homedir();
const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- Helpers ---

export function resolveConfigPath(override?: string): string {
  if (override) return resolve(override);
  const configHome = process.env.XDG_CONFIG_HOME || `${HOME}/.config`;
  return `${configHome}/qmd/config.yaml`;
}

export interface MergeResult {
  action: "created" | "exists" | "added";
  config: Record<string, unknown>;
}

export function mergeMcpConfig(
  existing: Record<string, unknown> | null,
  fragment: Record<string, unknown>,
): MergeResult {
  if (!existing) {
    return { action: "created", config: { mcpServers: fragment } };
  }

  const mcpServers = (existing.mcpServers || {}) as Record<string, unknown>;
  if (mcpServers.qmd) {
    return { action: "exists", config: existing };
  }

  return {
    action: "added",
    config: {
      ...existing,
      mcpServers: { ...mcpServers, qmd: (fragment as Record<string, unknown>).qmd },
    },
  };
}

export function mergeStatusLine(
  existing: Record<string, unknown> | null,
  fragment: Record<string, unknown>,
): MergeResult {
  if (!existing) {
    return { action: "created", config: { statusLine: fragment } };
  }
  if (existing.statusLine) {
    return { action: "exists", config: existing };
  }
  return { action: "added", config: { ...existing, statusLine: fragment } };
}

const RTK_HOOK_COMMAND = "rtk hook claude";

export function mergeHook(
  existing: Record<string, unknown> | null,
  fragment: Record<string, unknown>,
): MergeResult {
  if (!existing) {
    return { action: "created", config: { hooks: { PreToolUse: [fragment] } } };
  }

  const hooks = (existing.hooks || {}) as Record<string, unknown>;
  const preToolUse = (hooks.PreToolUse || []) as Array<Record<string, unknown>>;
  const alreadyPresent = preToolUse.some((entry) =>
    ((entry.hooks || []) as Array<Record<string, unknown>>).some(
      (h) => h.command === RTK_HOOK_COMMAND,
    ),
  );
  if (alreadyPresent) {
    return { action: "exists", config: existing };
  }

  return {
    action: "added",
    config: {
      ...existing,
      hooks: { ...hooks, PreToolUse: [...preToolUse, fragment] },
    },
  };
}

function symlinkSafe(src: string, dst: string): void {
  if (lstatSync(dst, { throwIfNoEntry: false })?.isSymbolicLink()) {
    const current = readlinkSync(dst);
    if (current === src) {
      console.log(`  OK   ${dst}`);
      return;
    }
    // Wrong target — remove and re-link
    unlinkSync(dst);
  } else if (existsSync(dst)) {
    const backup = `${dst}.bak.${Math.floor(Date.now() / 1000)}`;
    renameSync(dst, backup);
    console.log(`  BACK ${dst} (backed up)`);
  }

  mkdirSync(dirname(dst), { recursive: true });
  symlinkSync(src, dst);
  console.log(`  LINK ${dst} -> ${src}`);
}

// --- Main ---

function main(configOverride?: string): void {
  console.log("=== ai-coding-setup ===");
  console.log(`Repo: ${REPO_DIR}`);
  console.log("");

  // ── Step 1: Symlink scripts ────────────────────────────────────────
  console.log("--- Installing scripts ---");
  symlinkSafe(`${REPO_DIR}/bin/qmd-auto-embed.sh`, `${HOME}/.local/bin/qmd-auto-embed.sh`);
  mkdirSync(`${HOME}/.local/log`, { recursive: true });
  console.log("");

  // ── Step 2: Symlink skills and rules ───────────────────────────────
  console.log("--- Installing Claude Code skills and rules ---");
  symlinkSafe(`${REPO_DIR}/skills/qmd-add`, `${HOME}/.claude/skills/qmd-add`);
  symlinkSafe(`${REPO_DIR}/skills/qmd-update`, `${HOME}/.claude/skills/qmd-update`);
  symlinkSafe(`${REPO_DIR}/rules/qmd.md`, `${HOME}/.claude/rules/qmd.md`);
  symlinkSafe(`${REPO_DIR}/rules/rtk.md`, `${HOME}/.claude/rules/rtk.md`);
  console.log("");

  // ── Step 3: Inject MCP config ──────────────────────────────────────
  console.log("--- Configuring MCP server ---");
  const claudeJsonPath = `${HOME}/.claude.json`;
  const mcpFragment = JSON.parse(readFileSync(`${REPO_DIR}/fragments/mcp-server.json`, "utf-8"));

  const existing = existsSync(claudeJsonPath)
    ? JSON.parse(readFileSync(claudeJsonPath, "utf-8"))
    : null;
  const { action, config } = mergeMcpConfig(existing, mcpFragment);

  if (action !== "exists") {
    writeFileSync(claudeJsonPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  const labels = {
    created: `  CREATE ${claudeJsonPath}`,
    exists: "  OK   qmd MCP server already configured",
    added: "  ADD  qmd MCP server",
  };
  console.log(labels[action]);
  console.log("");

  // ── Step 3b: Inject status line into Claude Code settings ─────────
  console.log("--- Configuring status line ---");
  const settingsPath = `${HOME}/.claude/settings.json`;
  const statusFragment = JSON.parse(
    readFileSync(`${REPO_DIR}/fragments/status-line.json`, "utf-8"),
  );
  const existingSettings = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf-8"))
    : null;
  const { action: slAction, config: slConfig } = mergeStatusLine(existingSettings, statusFragment);
  if (slAction !== "exists") {
    mkdirSync(`${HOME}/.claude`, { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(slConfig, null, 2)}\n`);
  }
  const slLabels = {
    created: `  CREATE ${settingsPath}`,
    exists: "  OK   status line already configured",
    added: "  ADD  status line",
  };
  console.log(slLabels[slAction]);
  console.log("");

  // ── Step 3c: Inject rtk PreToolUse hook ───────────────────────────
  console.log("--- Configuring rtk hook ---");
  const hookFragment = JSON.parse(readFileSync(`${REPO_DIR}/fragments/rtk-hook.json`, "utf-8"));
  const existingSettings2 = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf-8"))
    : null;
  const { action: hookAction, config: hookConfig } = mergeHook(existingSettings2, hookFragment);
  if (hookAction !== "exists") {
    mkdirSync(`${HOME}/.claude`, { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(hookConfig, null, 2)}\n`);
  }
  const hookLabels = {
    created: `  CREATE ${settingsPath}`,
    exists: "  OK   rtk hook already configured",
    added: "  ADD  rtk hook",
  };
  console.log(hookLabels[hookAction]);
  console.log("");

  // ── Step 4: Sync collections ───────────────────────────────────────
  console.log("--- Adding collections ---");
  const configPath = resolveConfigPath(configOverride);
  syncCollections(configPath);
  console.log("");

  // ── Step 5: Build index + embeddings ───────────────────────────────
  console.log("--- Building index and embeddings ---");
  let indexOk = true;
  try {
    execSync(`"${HOME}/.local/bin/qmd-auto-embed.sh"`, { stdio: "inherit" });
  } catch {
    indexOk = false;
    console.log("  WARN: indexing failed (see output above)");
  }
  console.log(`  See log: ~/.local/log/qmd-auto-embed.log`);
  console.log("");

  // ── Step 6: Set up file-watcher (launchd on macOS, systemd on Linux)
  const scheduler = getScheduler();
  console.log(`--- Setting up ${scheduler.label} auto-embed ---`);
  scheduler.regen(configPath);
  console.log("");

  if (indexOk) {
    console.log("=== Setup complete ===");
  } else {
    console.log("=== Setup finished with errors: qmd indexing failed ===");
    process.exitCode = 1;
  }
}

// --- CLI ---

export function cli(argv = process.argv): void {
  const program = new Command()
    .name(pkg.name)
    .description(pkg.description)
    .version(pkg.version)
    .option("-c, --config <path>", "path to config.yaml");

  const configPath = () => resolveConfigPath(program.opts().config);

  program.action(() => main(program.opts().config));

  program
    .command("sync")
    .description("Sync collections from config.yaml to qmd")
    .option("--remove", "Remove collections not in config")
    .action((opts) => syncCollections(configPath(), { remove: opts.remove }));

  program
    .command("regen-scheduler")
    .description("Regenerate file-watcher (auto-detects platform)")
    .action(() => {
      const scheduler = getScheduler();
      scheduler.regen(configPath());
    });

  program.parse(argv);
}

// Run when executed directly
let isMain = false;
try {
  isMain = realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
} catch {}
if (isMain) {
  cli();
}
