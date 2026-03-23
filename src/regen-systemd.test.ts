import assert from "node:assert/strict";
import * as realFs from "node:fs";
import { homedir } from "node:os";
import { afterEach, describe, it, mock } from "node:test";
import type { Collection } from "./sync-collections.js";

// --- Mock setup (same proxy pattern as regen-plist.test.ts) ---
let existsFn: (p: string) => boolean = realFs.existsSync;

mock.module("node:fs", {
  namedExports: { ...realFs, existsSync: (p: string) => existsFn(p) },
});

const { buildServiceUnit, buildPathUnit } = await import("./regen-systemd.js");
// extractWatchPaths is tested in regen-plist.test.ts — reuse it here for integration
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
    const unit = buildPathUnit(["/repo1/.git/refs", "/repo2/.git/refs"]);
    assert.ok(unit.includes("[Path]"));
    assert.ok(unit.includes("[Install]"));
    assert.ok(unit.includes("PathChanged=/repo1/.git/refs"));
    assert.ok(unit.includes("PathChanged=/repo2/.git/refs"));
  });

  it("references qmd-auto-embed.service", () => {
    const unit = buildPathUnit(["/r/.git/refs"]);
    assert.ok(unit.includes("Unit=qmd-auto-embed.service"));
  });

  it("includes WantedBy=default.target for auto-start", () => {
    const unit = buildPathUnit([]);
    assert.ok(unit.includes("WantedBy=default.target"));
  });

  it("handles single watch path", () => {
    const unit = buildPathUnit(["/only/.git/refs"]);
    const matches = unit.match(/PathChanged=\/only\/.git\/refs/g);
    assert.equal(matches?.length, 1);
  });
});
