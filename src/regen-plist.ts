import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";
import { parse as parseYaml } from "yaml";
import type { Collection, Config } from "./sync-collections.js";
import { expandHome } from "./sync-collections.js";

const HOME = homedir();
const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadTemplate(name: string): string {
  return readFileSync(resolve(REPO_DIR, "templates", name), "utf-8");
}

const DEFAULT_THROTTLE_INTERVAL = 30;

export function buildPlistXml(
  watchPaths: string[],
  home: string,
  throttleInterval?: number,
): string {
  const template = loadTemplate("launchd-plist.mustache");
  return Mustache.render(template, {
    watchPaths,
    home,
    throttleInterval: throttleInterval ?? DEFAULT_THROTTLE_INTERVAL,
  });
}

export function extractWatchPaths(collections: Collection[]): string[] {
  const paths: string[] = [];
  for (const col of collections) {
    const fullPath = expandHome(col.path);
    const refsDir = `${fullPath}/.git/refs`;
    if (existsSync(refsDir)) {
      paths.push(refsDir);
    } else {
      console.error(`  SKIP ${col.path} — not a git repo`);
    }
  }
  return paths;
}

export function regenPlist(configPath: string): void {
  const plistPath = `${HOME}/Library/LaunchAgents/com.qmd.auto-embed.plist`;

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

  const plist = buildPlistXml(watchPaths, HOME, config.launchd?.throttle_interval);

  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, plist);
  console.log(`  Wrote ${plistPath} with ${watchPaths.length} watched repos`);

  // Reload the agent
  const uid = execSync("id -u", { encoding: "utf-8" }).trim();
  try {
    execSync(`launchctl bootout gui/${uid} "${plistPath}" 2>/dev/null`, {
      stdio: "pipe",
    });
  } catch {
    // Ignore — agent may not be loaded yet
  }
  execSync(`launchctl bootstrap gui/${uid} "${plistPath}"`);
  console.log("  Loaded com.qmd.auto-embed");
}

export const launchdScheduler = {
  label: "launchd",
  regen: regenPlist,
};
