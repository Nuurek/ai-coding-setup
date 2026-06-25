import assert from "node:assert/strict";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { MergeResult } from "./setup.js";
import { mergeHook, mergeMcpConfig, mergeStatusLine, resolveConfigPath } from "./setup.js";

describe("mergeMcpConfig", () => {
  const fragment = { qmd: { command: "qmd", args: ["mcp"] } };

  it("creates new config when existing is null", () => {
    const result: MergeResult = mergeMcpConfig(null, fragment);
    assert.equal(result.action, "created");
    assert.deepEqual(result.config, { mcpServers: { qmd: { command: "qmd", args: ["mcp"] } } });
  });

  it("returns exists when qmd already configured", () => {
    const existing = { mcpServers: { qmd: { command: "qmd", args: ["mcp"] } } };
    const result = mergeMcpConfig(existing, fragment);
    assert.equal(result.action, "exists");
    assert.deepEqual(result.config, existing);
  });

  it("adds qmd to existing mcpServers", () => {
    const existing = { mcpServers: { other: { command: "other" } } };
    const result = mergeMcpConfig(existing, fragment);
    assert.equal(result.action, "added");
    assert.deepEqual(result.config.mcpServers, {
      other: { command: "other" },
      qmd: { command: "qmd", args: ["mcp"] },
    });
  });

  it("creates mcpServers key when missing from existing config", () => {
    const existing = { someOtherKey: true };
    const result = mergeMcpConfig(existing, fragment);
    assert.equal(result.action, "added");
    assert.deepEqual(result.config.mcpServers, { qmd: { command: "qmd", args: ["mcp"] } });
  });

  it("preserves other top-level keys", () => {
    const existing = { theme: "dark", mcpServers: {} };
    const result = mergeMcpConfig(existing, fragment);
    assert.equal(result.action, "added");
    assert.equal((result.config as Record<string, unknown>).theme, "dark");
  });
});

describe("mergeStatusLine", () => {
  const fragment = { type: "command", command: "echo status" };

  it("creates new settings when existing is null", () => {
    const result: MergeResult = mergeStatusLine(null, fragment);
    assert.equal(result.action, "created");
    assert.deepEqual(result.config, { statusLine: fragment });
  });

  it("returns exists when statusLine already configured", () => {
    const existing = { statusLine: { type: "command", command: "echo custom" } };
    const result = mergeStatusLine(existing, fragment);
    assert.equal(result.action, "exists");
    assert.deepEqual(result.config, existing);
  });

  it("adds statusLine to existing settings without one", () => {
    const existing = { model: "opusplan" };
    const result = mergeStatusLine(existing, fragment);
    assert.equal(result.action, "added");
    assert.deepEqual(result.config.statusLine, fragment);
  });

  it("preserves other top-level keys when adding", () => {
    const existing = { model: "opusplan", env: { FOO: "bar" } };
    const result = mergeStatusLine(existing, fragment);
    assert.equal(result.action, "added");
    assert.equal((result.config as Record<string, unknown>).model, "opusplan");
    assert.deepEqual((result.config as Record<string, unknown>).env, { FOO: "bar" });
  });
});

describe("resolveConfigPath", () => {
  const origXdg = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (origXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origXdg;
    }
  });

  it("returns default ~/.config/qmd/config.yaml", () => {
    delete process.env.XDG_CONFIG_HOME;
    assert.equal(resolveConfigPath(), `${homedir()}/.config/qmd/config.yaml`);
  });

  it("respects XDG_CONFIG_HOME", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-test";
    assert.equal(resolveConfigPath(), "/tmp/xdg-test/qmd/config.yaml");
  });

  it("returns resolved override when provided", () => {
    assert.equal(resolveConfigPath("./my-config.yaml"), resolve("./my-config.yaml"));
  });

  it("override takes precedence over XDG_CONFIG_HOME", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-test";
    assert.equal(resolveConfigPath("/custom/path.yaml"), "/custom/path.yaml");
  });
});

describe("mergeHook", () => {
  const fragment = { matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] };

  it("creates new settings when existing is null", () => {
    const result: MergeResult = mergeHook(null, fragment);
    assert.equal(result.action, "created");
    assert.deepEqual(result.config, { hooks: { PreToolUse: [fragment] } });
  });

  it("returns exists when rtk hook already present", () => {
    const existing = { hooks: { PreToolUse: [fragment] } };
    const result = mergeHook(existing, fragment);
    assert.equal(result.action, "exists");
    assert.deepEqual(result.config, existing);
  });

  it("adds hook to settings with no hooks key", () => {
    const existing = { model: "opusplan" };
    const result = mergeHook(existing, fragment);
    assert.equal(result.action, "added");
    assert.deepEqual(result.config.hooks, { PreToolUse: [fragment] });
  });

  it("appends hook to existing PreToolUse array, preserving prior entries", () => {
    const prior = { matcher: "Bash", hooks: [{ type: "command", command: "other hook" }] };
    const existing = { hooks: { PreToolUse: [prior] } };
    const result = mergeHook(existing, fragment);
    assert.equal(result.action, "added");
    assert.deepEqual((result.config.hooks as Record<string, unknown[]>).PreToolUse, [
      prior,
      fragment,
    ]);
  });

  it("preserves other top-level keys", () => {
    const existing = { statusLine: { type: "command", command: "echo hi" }, model: "sonnet" };
    const result = mergeHook(existing, fragment);
    assert.equal(result.action, "added");
    assert.deepEqual((result.config as Record<string, unknown>).statusLine, existing.statusLine);
    assert.equal((result.config as Record<string, unknown>).model, "sonnet");
  });

  it("preserves other hook types (PostToolUse)", () => {
    const existing = {
      hooks: {
        PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "post hook" }] }],
      },
    };
    const result = mergeHook(existing, fragment);
    assert.equal(result.action, "added");
    assert.deepEqual(
      (result.config.hooks as Record<string, unknown>).PostToolUse,
      existing.hooks.PostToolUse,
    );
  });
});
