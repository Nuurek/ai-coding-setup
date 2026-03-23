import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";
import { parse as parseYaml } from "yaml";
import { extractWatchPaths } from "./regen-plist.js";
import type { Config } from "./sync-collections.js";

const HOME = homedir();
const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadTemplate(name: string): string {
  return readFileSync(resolve(REPO_DIR, "templates", name), "utf-8");
}

export function buildServiceUnit(home: string): string {
  const template = loadTemplate("systemd-service.mustache");
  return Mustache.render(template, { home });
}

export function buildPathUnit(watchPaths: string[]): string {
  const template = loadTemplate("systemd-path.mustache");
  return Mustache.render(template, { watchPaths });
}

function systemdUserDir(): string {
  return `${HOME}/.config/systemd/user`;
}

export function regenSystemd(configPath: string): void {
  const unitDir = systemdUserDir();
  const servicePath = `${unitDir}/qmd-auto-embed.service`;
  const pathUnitPath = `${unitDir}/qmd-auto-embed.path`;

  if (!existsSync(configPath)) {
    console.error(`  Error: ${configPath} not found`);
    process.exit(1);
  }

  const config: Config = parseYaml(readFileSync(configPath, "utf-8"));
  const watchPaths = extractWatchPaths(config.collections || []);

  if (watchPaths.length === 0) {
    console.error("  Error: no repo paths with .git/refs found");
    process.exit(1);
  }

  const serviceUnit = buildServiceUnit(HOME);
  const pathUnit = buildPathUnit(watchPaths);

  mkdirSync(unitDir, { recursive: true });
  writeFileSync(servicePath, serviceUnit);
  writeFileSync(pathUnitPath, pathUnit);
  console.log(`  Wrote ${servicePath}`);
  console.log(`  Wrote ${pathUnitPath} with ${watchPaths.length} watched repos`);

  // Reload and enable
  execSync("systemctl --user daemon-reload", { stdio: "pipe" });
  execSync("systemctl --user enable --now qmd-auto-embed.path", {
    stdio: "pipe",
  });
  console.log("  Enabled qmd-auto-embed.path");
}

export const systemdScheduler = {
  label: "systemd",
  regen: regenSystemd,
};
