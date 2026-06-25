import assert from "node:assert/strict";
import * as realFs from "node:fs";
import { homedir } from "node:os";
import { afterEach, describe, it, mock } from "node:test";
import type { Collection } from "./sync-collections.js";

// --- Mock setup ---
// Proxy existsSync through a mutable reference so tests can swap behaviour.
let existsFn: (p: string) => boolean = realFs.existsSync;

// `constants` excluded — it's non-configurable in Node v26+ and can't be redefined via mock.
const { constants: _fsConstants, ...fsWithoutConstants } = realFs as typeof realFs & {
  constants: unknown;
};
const proxiedExistsSync = (p: string) => existsFn(p);
mock.module("node:fs", {
  namedExports: { ...fsWithoutConstants, existsSync: proxiedExistsSync },
});

// Import AFTER mock — the module binds to our proxied existsSync.
const { buildPlistXml, extractWatchPaths } = await import("./regen-plist.js");

afterEach(() => {
  existsFn = realFs.existsSync;
});

// --- Pure function tests ---

describe("buildPlistXml", () => {
  it("generates valid plist with watch paths", () => {
    const xml = buildPlistXml(["/repo1/.git/logs/HEAD", "/repo2/.git/logs/HEAD"], "/Users/test");
    assert.ok(xml.includes('<?xml version="1.0"'));
    assert.ok(xml.includes("<string>/repo1/.git/logs/HEAD</string>"));
    assert.ok(xml.includes("<string>/repo2/.git/logs/HEAD</string>"));
  });

  it("uses home for script and log paths", () => {
    const xml = buildPlistXml(["/r/.git/logs/HEAD"], "/home/me");
    assert.ok(xml.includes("<string>/home/me/.local/bin/qmd-auto-embed.sh</string>"));
    assert.ok(xml.includes("<string>/home/me/.local/log/qmd-auto-embed.log</string>"));
  });

  it("sets label to com.qmd.auto-embed", () => {
    const xml = buildPlistXml([], "/home/me");
    assert.ok(xml.includes("<string>com.qmd.auto-embed</string>"));
  });

  it("defaults throttle interval to 30", () => {
    const xml = buildPlistXml([], "/home/me");
    assert.ok(xml.includes("<integer>30</integer>"));
  });

  it("accepts custom throttle interval", () => {
    const xml = buildPlistXml([], "/home/me", 60);
    assert.ok(xml.includes("<integer>60</integer>"));
    assert.ok(!xml.includes("<integer>30</integer>"));
  });

  it("handles single watch path", () => {
    const xml = buildPlistXml(["/only/.git/logs/HEAD"], "/home/me");
    const matches = xml.match(/<string>\/only\/.git\/logs\/HEAD<\/string>/g);
    assert.equal(matches?.length, 1);
  });
});

// --- Side-effect tests (patched fs) ---

describe("extractWatchPaths", () => {
  it("returns empty array for empty collections", () => {
    assert.deepEqual(extractWatchPaths([]), []);
  });

  it("skips paths where .git does not exist (not a git repo)", () => {
    existsFn = () => false;
    const collections: Collection[] = [{ path: "/repos/myrepo", masks: ["docs"] }];
    assert.deepEqual(extractWatchPaths(collections), []);
  });

  it("skips paths where .git exists but logs/HEAD does not (reflogs disabled)", () => {
    existsFn = (p) => p === "/repos/myrepo/.git";
    const collections: Collection[] = [{ path: "/repos/myrepo", masks: ["docs"] }];
    assert.deepEqual(extractWatchPaths(collections), []);
  });

  it("includes paths where .git/logs/HEAD exists", () => {
    existsFn = (p) => p === "/repos/myrepo/.git/logs/HEAD";
    const collections: Collection[] = [{ path: "/repos/myrepo", masks: ["docs"] }];
    assert.deepEqual(extractWatchPaths(collections), ["/repos/myrepo/.git/logs/HEAD"]);
  });

  it("expands ~ in paths", () => {
    const home = homedir();
    existsFn = (p) => p === `${home}/repos/myrepo/.git/logs/HEAD`;
    const collections: Collection[] = [{ path: "~/repos/myrepo", masks: ["docs"] }];
    assert.deepEqual(extractWatchPaths(collections), [`${home}/repos/myrepo/.git/logs/HEAD`]);
  });

  it("filters mixed collections: includes repo with logs/HEAD, skips repo without", () => {
    existsFn = (p) => p === "/repos/a/.git/logs/HEAD" || p === "/repos/b/.git";
    const collections: Collection[] = [
      { path: "/repos/a", masks: ["docs"] },
      { path: "/repos/b", masks: ["docs"] },
    ];
    assert.deepEqual(extractWatchPaths(collections), ["/repos/a/.git/logs/HEAD"]);
  });

  it("includes multiple repos", () => {
    existsFn = (p) => p.endsWith("/.git/logs/HEAD");
    const collections: Collection[] = [
      { path: "/repos/a", masks: ["docs"] },
      { path: "/repos/b", masks: ["docs"] },
    ];
    const result = extractWatchPaths(collections);
    assert.equal(result.length, 2);
    assert.ok(result.includes("/repos/a/.git/logs/HEAD"));
    assert.ok(result.includes("/repos/b/.git/logs/HEAD"));
  });
});
