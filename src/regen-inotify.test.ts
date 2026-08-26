import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWatchScript } from "./regen-inotify.js";

describe("buildWatchScript", () => {
  it("renders a bash shebang", () => {
    const script = buildWatchScript(["/repo/.git/logs/HEAD"]);
    assert.ok(script.startsWith("#!/usr/bin/env bash"));
  });

  it("uses inotifywait to watch for changes", () => {
    const script = buildWatchScript(["/repo/.git/logs/HEAD"]);
    assert.ok(script.includes("inotifywait"));
  });

  it("includes each supplied watch path verbatim", () => {
    const script = buildWatchScript(["/repos/alpha/.git/logs/HEAD", "/repos/beta/.git/logs/HEAD"]);
    assert.ok(script.includes('"/repos/alpha/.git/logs/HEAD"'));
    assert.ok(script.includes('"/repos/beta/.git/logs/HEAD"'));
  });

  it("runs qmd-auto-embed.sh on change", () => {
    const script = buildWatchScript(["/repo/.git/logs/HEAD"]);
    assert.ok(script.includes("qmd-auto-embed.sh"));
  });
});
