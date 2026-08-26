import assert from "node:assert/strict";
import * as realFs from "node:fs";
import * as realOs from "node:os";
import { afterEach, describe, it, mock } from "node:test";

// --- Mock setup (same proxy pattern as regen-systemd.test.ts) ---
let existsFn: (p: string) => boolean = realFs.existsSync;
let platformFn: () => NodeJS.Platform = realOs.platform;

// `constants` excluded — it's non-configurable in Node v26+ and can't be redefined via mock.
const { constants: _fsConstants, ...fsWithoutConstants } = realFs as typeof realFs & {
  constants: unknown;
};
mock.module("node:fs", {
  namedExports: { ...fsWithoutConstants, existsSync: (p: string) => existsFn(p) },
});
mock.module("node:os", {
  namedExports: { ...realOs, platform: () => platformFn() },
});

const { hasSystemd, getScheduler } = await import("./scheduler.js");

afterEach(() => {
  existsFn = realFs.existsSync;
  platformFn = realOs.platform;
});

describe("hasSystemd", () => {
  it("is true when /run/systemd/system exists", () => {
    existsFn = (p) => p === "/run/systemd/system";
    assert.equal(hasSystemd(), true);
  });

  it("is false when /run/systemd/system is absent", () => {
    existsFn = () => false;
    assert.equal(hasSystemd(), false);
  });
});

describe("getScheduler", () => {
  it("selects launchd on macOS", () => {
    platformFn = () => "darwin";
    assert.equal(getScheduler().label, "launchd");
  });

  it("selects systemd on Linux with systemd running", () => {
    platformFn = () => "linux";
    existsFn = (p) => p === "/run/systemd/system";
    assert.equal(getScheduler().label, "systemd");
  });

  it("selects inotify on Linux without systemd (container)", () => {
    platformFn = () => "linux";
    existsFn = () => false;
    assert.equal(getScheduler().label, "inotify");
  });

  it("throws on unsupported platforms", () => {
    platformFn = () => "win32";
    assert.throws(() => getScheduler(), /Unsupported platform: win32/);
  });
});
