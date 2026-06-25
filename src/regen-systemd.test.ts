import assert from "node:assert/strict";
import * as realFs from "node:fs";
import { afterEach, describe, it, mock } from "node:test";

// --- Mock setup (same proxy pattern as regen-plist.test.ts) ---
let existsFn: (p: string) => boolean = realFs.existsSync;

// `constants` excluded — it's non-configurable in Node v26+ and can't be redefined via mock.
const { constants: _fsConstants, ...fsWithoutConstants } = realFs as typeof realFs & {
  constants: unknown;
};
const proxiedExistsSync = (p: string) => existsFn(p);
mock.module("node:fs", {
  namedExports: { ...fsWithoutConstants, existsSync: proxiedExistsSync },
});

const { buildServiceUnit, buildPathUnit } = await import("./regen-systemd.js");
const { extractWatchPaths } = await import("./regen-plist.js");

afterEach(() => {
  existsFn = realFs.existsSync;
});

// --- Service unit tests ---

describe("buildServiceUnit", () => {
  it("generates a valid systemd service unit", () => {
    const unit = buildServiceUnit("/home/test");
    assert.ok(unit.includes("[Unit]"));
    assert.ok(unit.includes("[Service]"));
    assert.ok(unit.includes("Type=oneshot"));
    assert.ok(unit.includes("ExecStart=/home/test/.local/bin/qmd-auto-embed.sh"));
  });

  it("uses home for log paths", () => {
    const unit = buildServiceUnit("/home/me");
    assert.ok(unit.includes("append:/home/me/.local/log/qmd-auto-embed.log"));
  });
});

// --- Path unit tests ---

describe("buildPathUnit", () => {
  it("generates a valid systemd path unit", () => {
    const unit = buildPathUnit(["/repo1/.git/logs/HEAD", "/repo2/.git/logs/HEAD"]);
    assert.ok(unit.includes("[Path]"));
    assert.ok(unit.includes("[Install]"));
    assert.ok(unit.includes("PathModified=/repo1/.git/logs/HEAD"));
    assert.ok(unit.includes("PathModified=/repo2/.git/logs/HEAD"));
  });

  it("references qmd-auto-embed.service", () => {
    const unit = buildPathUnit(["/r/.git/logs/HEAD"]);
    assert.ok(unit.includes("Unit=qmd-auto-embed.service"));
  });

  it("includes WantedBy=default.target for auto-start", () => {
    const unit = buildPathUnit([]);
    assert.ok(unit.includes("WantedBy=default.target"));
  });

  it("handles single watch path", () => {
    const unit = buildPathUnit(["/only/.git/logs/HEAD"]);
    const matches = unit.match(/PathModified=\/only\/.git\/logs\/HEAD/g);
    assert.equal(matches?.length, 1);
  });
});

// --- Integration: extractWatchPaths -> buildPathUnit ---

describe("extractWatchPaths -> buildPathUnit integration", () => {
  it("produces PathModified entries pointing at .git/logs/HEAD", () => {
    existsFn = (p) => p.endsWith("/.git/logs/HEAD");
    const collections = [
      { path: "/repos/alpha", masks: ["docs"] },
      { path: "/repos/beta", masks: ["docs"] },
    ];
    const watchPaths = extractWatchPaths(collections);
    const unit = buildPathUnit(watchPaths);
    assert.ok(unit.includes("PathModified=/repos/alpha/.git/logs/HEAD"));
    assert.ok(unit.includes("PathModified=/repos/beta/.git/logs/HEAD"));
  });
});
