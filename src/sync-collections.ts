import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

// --- Types ---

export interface LaunchdConfig {
  throttle_interval?: number;
}

export interface Config {
  masks: Record<string, string[]>;
  collections: Collection[];
  launchd?: LaunchdConfig;
}

export interface Collection {
  path: string;
  name?: string;
  masks: string[];
}

// --- Helpers ---

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const expandHome = (p: string): string => p.replace(/^~/, homedir());

export function buildGlob(maskNames: string[], masks: Record<string, string[]>): string {
  const exts = new Set<string>();
  for (const name of maskNames) {
    const mask = masks[name];
    if (!mask) {
      console.error(`  ERR  unknown mask: ${name}`);
      continue;
    }
    for (const ext of mask) exts.add(ext);
  }
  const sorted = [...exts].sort();
  return `**/*.{${sorted.join(",")}}`;
}

export function parseCollectionNames(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(\S+) \(qmd:\/\//);
    if (match) names.push(match[1]);
  }
  return names;
}

// --- Main ---

export interface SyncOptions {
  remove?: boolean;
}

export function syncCollections(configPath: string, options?: SyncOptions): void {
  if (!existsSync(configPath)) {
    const example = resolve(REPO_DIR, "config.example.yaml");
    mkdirSync(dirname(configPath), { recursive: true });
    copyFileSync(example, configPath);
    console.log(`  CREATE ${configPath} (copied from config.example.yaml)`);
    console.log(`  Edit it to add your collections, then re-run qmd-setup.`);
  }
  const config: Config = parseYaml(readFileSync(configPath, "utf-8"));
  const masks = config.masks || {};
  const collections = config.collections || [];

  let added = 0,
    skipped = 0,
    ok = 0,
    errors = 0;

  for (const col of collections) {
    const path = expandHome(col.path);
    const name = col.name || basename(path);
    const glob = buildGlob(col.masks || [], masks);

    if (!existsSync(path)) {
      console.log(`  SKIP ${name} — ${path} not found`);
      skipped++;
      continue;
    }

    try {
      execSync(`qmd collection add "${path}" --name "${name}" --mask "${glob}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      console.log(`  ADD  ${name}`);
      added++;
    } catch (e: unknown) {
      const err = e as { stderr?: string; stdout?: string };
      const stderr = err.stderr || err.stdout || "";
      if (stderr.includes("already exists") || err.stdout?.includes("already exists")) {
        console.log(`  OK   ${name}`);
        ok++;
      } else {
        console.error(`  ERR  ${name}: ${stderr.trim()}`);
        errors++;
      }
    }
  }

  let removed = 0;
  if (options?.remove) {
    const configNames = new Set(
      collections.map((col) => col.name || basename(expandHome(col.path))),
    );
    const qmdNames = parseCollectionNames(execSync("qmd collection list", { encoding: "utf-8" }));
    for (const name of qmdNames) {
      if (!configNames.has(name)) {
        execSync(`qmd collection remove "${name}"`, { stdio: "pipe" });
        console.log(`  DEL  ${name}`);
        removed++;
      }
    }
  }

  const parts = [`${added} added`, `${ok} existing`, `${skipped} skipped`, `${errors} errors`];
  if (options?.remove) parts.push(`${removed} removed`);
  console.log(`\n  Summary: ${parts.join(", ")}`);
  if (errors > 0) process.exit(1);
}
