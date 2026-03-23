import { platform } from "node:os";
import { launchdScheduler } from "./regen-plist.js";
import { systemdScheduler } from "./regen-systemd.js";

export interface Scheduler {
  readonly label: string;
  regen(configPath: string): void;
}

const schedulers: Record<string, Scheduler> = {
  darwin: launchdScheduler,
  linux: systemdScheduler,
};

export function getScheduler(): Scheduler {
  const p = platform();
  const scheduler = schedulers[p];
  if (!scheduler) throw new Error(`Unsupported platform: ${p}`);
  return scheduler;
}
