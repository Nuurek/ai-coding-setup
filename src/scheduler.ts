import { existsSync } from "node:fs";
import { platform } from "node:os";
import { inotifyScheduler } from "./regen-inotify.js";
import { launchdScheduler } from "./regen-plist.js";
import { systemdScheduler } from "./regen-systemd.js";

export interface Scheduler {
  readonly label: string;
  regen(configPath: string): void;
}

// systemd's runtime dir only exists when it's running as init; absent in containers.
export function hasSystemd(): boolean {
  return existsSync("/run/systemd/system");
}

export function getScheduler(): Scheduler {
  const p = platform();
  if (p === "darwin") return launchdScheduler;
  if (p === "linux") return hasSystemd() ? systemdScheduler : inotifyScheduler;
  throw new Error(`Unsupported platform: ${p}`);
}
