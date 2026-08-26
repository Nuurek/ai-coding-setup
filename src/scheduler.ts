import { existsSync } from "node:fs";
import { platform } from "node:os";
import { inotifyScheduler } from "./regen-inotify.js";
import { launchdScheduler } from "./regen-plist.js";
import { systemdScheduler } from "./regen-systemd.js";

export interface Scheduler {
  readonly label: string;
  regen(configPath: string): void;
}

// systemd is only usable when its runtime dir exists (i.e. it's running as PID 1).
// Inside a container there is no init, so fall back to a raw inotify watcher.
export function hasSystemd(): boolean {
  return existsSync("/run/systemd/system");
}

export function getScheduler(): Scheduler {
  const p = platform();
  if (p === "darwin") return launchdScheduler;
  if (p === "linux") return hasSystemd() ? systemdScheduler : inotifyScheduler;
  throw new Error(`Unsupported platform: ${p}`);
}
