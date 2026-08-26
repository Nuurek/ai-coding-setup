import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";
import { parse as parseYaml } from "yaml";
import { extractWatchPaths } from "./regen-plist.js";
import type { Config } from "./sync-collections.js";

const HOME = homedir();
const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const WATCH_SCRIPT = `${HOME}/.local/bin/qmd-auto-embed-watch.sh`;
const PID_FILE = `${HOME}/.local/state/ai-coding-setup/qmd-auto-embed-watch.pid`;
const LOG_FILE = `${HOME}/.local/log/qmd-auto-embed.log`;

function loadTemplate(name: string): string {
  return readFileSync(resolve(REPO_DIR, "templates", name), "utf-8");
}

export function buildWatchScript(watchPaths: string[]): string {
  return Mustache.render(loadTemplate("qmd-auto-embed-watch.mustache"), { watchPaths });
}

function ensureInotifywait(): boolean {
  try {
    execSync("command -v inotifywait", { stdio: "pipe" });
    return true;
  } catch {
    // not installed
  }
  console.log("  Installing inotify-tools...");
  try {
    execSync("sudo apt-get update -qq && sudo apt-get install -y inotify-tools", {
      stdio: "pipe",
    });
    return true;
  } catch {
    console.error("  WARN: could not install inotify-tools; watcher not started.");
    console.error("        install it, then run: ai-coding-setup regen-scheduler");
    return false;
  }
}

function restartWatcher(): void {
  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, "utf-8").trim();
    if (pid) {
      try {
        // negative pid kills the whole group: the loop and its blocked inotifywait child
        execSync(`kill -- -${pid}`, { stdio: "pipe" });
      } catch {
        // already gone
      }
    }
  }
  // setsid detaches into its own group so the kill above can reap loop + child together
  execSync(`setsid "${WATCH_SCRIPT}" >> "${LOG_FILE}" 2>&1 < /dev/null & echo $! > "${PID_FILE}"`, {
    stdio: "pipe",
    shell: "/bin/bash",
  });
}

export function regenInotify(configPath: string): void {
  if (!existsSync(configPath)) {
    console.error(`  Error: ${configPath} not found`);
    process.exit(1);
  }
  const config: Config = parseYaml(readFileSync(configPath, "utf-8"));
  const watchPaths = extractWatchPaths(config.collections || []);
  if (watchPaths.length === 0) {
    console.error("  Error: no repo paths with .git/logs/HEAD found");
    process.exit(1);
  }

  if (!ensureInotifywait()) return;

  mkdirSync(dirname(WATCH_SCRIPT), { recursive: true });
  mkdirSync(dirname(PID_FILE), { recursive: true });
  mkdirSync(dirname(LOG_FILE), { recursive: true });

  writeFileSync(WATCH_SCRIPT, buildWatchScript(watchPaths));
  chmodSync(WATCH_SCRIPT, 0o755);
  console.log(`  Wrote ${WATCH_SCRIPT} with ${watchPaths.length} watched repos`);

  restartWatcher();
  console.log("  Started qmd-auto-embed watcher");
}

export const inotifyScheduler = { label: "inotify", regen: regenInotify };
