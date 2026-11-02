// Reads the decrypted 1Password archive JSON from stdin, groups by provider,
// live-tests LLM keys (capturing HTTP status), and emits SQLCipher SQL on stdout.
// The SQL includes `PRAGMA key` from env PASS, so pipe stdout straight into
// `sqlcipher out.db`. NEVER writes key material or the passphrase to stderr.

const CONCURRENCY = 24;
const TIMEOUT_MS = 20000;
const PASS = process.env.PASS;
if (!PASS) {
  process.stderr.write("ERROR: PASS env not set\n");
  process.exit(1);
}

function readStdin() {
  return new Promise((res, rej) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", rej);
  });
}

const RULES = [
  [/perplexity/i, "Perplexity"],
  [/deepseek/i, "DeepSeek"],
  [/open\s*router/i, "OpenRouter"],
  [/open\s*ai/i, "OpenAI"],
  [/claude|anthropic/i, "Anthropic"],
  [/gemini/i, "Gemini"],
  [/togh?et?her/i, "Together AI"],
  [/fireworks/i, "Fireworks"],
  [/\bx\.?ai\b|grok/i, "xAI"],
  [/mistral/i, "Mistral"],
  [/groq/i, "Groq"],
  [/cerebras/i, "Cerebras"],
  [/cohere/i, "Cohere"],
  [/voyage/i, "Voyage AI"],
  [/llama/i, "Llama (LlamaCloud)"],
  [/vertex/i, "Vertex AI"],
];
function normalizeProvider(title) {
  for (const [re, name] of RULES) if (re.test(title)) return name;
  let head = title.split(/\s[-–—]\s/)[0].trim().replace(/\s+/g, " ");
  return head || "Unknown";
}

function extractSecret(item) {
  const fields = item.fields || [];
  const byId = (id) => fields.find((f) => f.id === id && typeof f.value === "string" && f.value);
  const byPurpose = (p) => fields.find((f) => f.purpose === p && typeof f.value === "string" && f.value);
  if (item.category === "API_CREDENTIAL") return byId("credential")?.value ?? null;
  if (item.category === "LOGIN" || item.category === "PASSWORD")
    return (byPurpose("PASSWORD") || byId("password"))?.value ?? null;
  if (item.category === "SECURE_NOTE") {
    const cands = fields
      .filter((f) => f.purpose !== "NOTES" && typeof f.value === "string" && f.value)
      .map((f) => f.value)
      .filter((v) => /[A-Za-z0-9_\-]{16,}/.test(v))
      .sort((a, b) => b.length - a.length);
    return cands[0] || null;
  }
  return null;
}

const TESTS = {
  OpenAI: { kind: "get", url: "https://api.openai.com/v1/models", h: (k) => ({ Authorization: `Bearer ${k}` }) },
  Anthropic: { kind: "get", url: "https://api.anthropic.com/v1/models", h: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
  Gemini: { kind: "gemini", url: (k) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`, h: () => ({}) },
  "Together AI": { kind: "get", url: "https://api.together.xyz/v1/models", h: (k) => ({ Authorization: `Bearer ${k}` }) },
  Fireworks: { kind: "get", url: "https://api.fireworks.ai/inference/v1/models", h: (k) => ({ Authorization: `Bearer ${k}` }) },
  xAI: { kind: "get", url: "https://api.x.ai/v1/models", h: (k) => ({ Authorization: `Bearer ${k}` }) },
  Mistral: { kind: "get", url: "https://api.mistral.ai/v1/models", h: (k) => ({ Authorization: `Bearer ${k}` }) },
  DeepSeek: { kind: "get", url: "https://api.deepseek.com/models", h: (k) => ({ Authorization: `Bearer ${k}` }) },
  Groq: { kind: "get", url: "https://api.groq.com/openai/v1/models", h: (k) => ({ Authorization: `Bearer ${k}` }) },
  Cerebras: { kind: "get", url: "https://api.cerebras.ai/v1/models", h: (k) => ({ Authorization: `Bearer ${k}` }) },
  OpenRouter: { kind: "get", url: "https://openrouter.ai/api/v1/key", h: (k) => ({ Authorization: `Bearer ${k}` }) },
  Cohere: { kind: "get", url: "https://api.cohere.com/v1/models", h: (k) => ({ Authorization: `Bearer ${k}` }) },
  Perplexity: { kind: "probe", url: "https://api.perplexity.ai/chat/completions", method: "POST", body: "{}", h: (k) => ({ Authorization: `Bearer ${k}`, "content-type": "application/json" }) },
  "Voyage AI": { kind: "probe", url: "https://api.voyageai.com/v1/embeddings", method: "POST", body: "{}", h: (k) => ({ Authorization: `Bearer ${k}`, "content-type": "application/json" }) },
};

// returns { status: 'working'|'untested'|'invalid', http: number|null }
async function testKey(provider, key) {
  const cfg = TESTS[provider];
  if (!cfg) return { status: "untested", http: null };
  const url = typeof cfg.url === "function" ? cfg.url(key) : cfg.url;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { method: cfg.method || "GET", headers: cfg.h(key), body: cfg.body, signal: ctrl.signal });
    const s = resp.status;
    let status;
    if (cfg.kind === "gemini") status = s === 200 || s === 429 ? "working" : s === 400 || s === 401 || s === 403 ? "invalid" : "untested";
    else if (cfg.kind === "probe") status = s === 401 || s === 403 ? "invalid" : [200, 429, 400, 422].includes(s) ? "working" : "untested";
    else status = s === 200 || s === 429 ? "working" : s === 401 || s === 403 ? "invalid" : "untested";
    return { status, http: s };
  } catch {
    return { status: "untested", http: null };
  } finally {
    clearTimeout(t);
  }
}

async function pool(items, worker) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  }));
  return results;
}

const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

async function main() {
  const archive = JSON.parse(await readStdin());
  const entries = [];
  for (const item of archive) {
    const key = extractSecret(item);
    if (!key) continue;
    entries.push({ id: item.id, name: item.title, key, provider: normalizeProvider(item.title) });
  }
  process.stderr.write(`Extracted ${entries.length} secrets; testing (concurrency ${CONCURRENCY})...\n`);

  let done = 0;
  const results = await pool(entries, async (e) => {
    const r = await testKey(e.provider, e.key);
    if (++done % 50 === 0) process.stderr.write(`  ...${done}/${entries.length}\n`);
    return r;
  });

  const now = new Date().toISOString();
  const out = [];
  out.push(`PRAGMA key = ${q(PASS)};`);
  out.push("PRAGMA cipher_page_size = 4096;");
  out.push("PRAGMA foreign_keys = ON;");
  out.push("DROP TABLE IF EXISTS keys;");
  out.push(`CREATE TABLE keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('working','untested')),
  http_status INTEGER,
  tested_at TEXT,
  source_id TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
  out.push("CREATE INDEX idx_keys_provider ON keys(provider);");
  out.push("CREATE INDEX idx_keys_status ON keys(status);");
  out.push("BEGIN;");

  const summary = {};
  entries.forEach((e, i) => {
    const { status, http } = results[i];
    summary[e.provider] = summary[e.provider] || { working: 0, untested: 0, invalid: 0 };
    summary[e.provider][status]++;
    if (status === "invalid") return; // drop, matching cleaned JSON
    const tested = TESTS[e.provider] ? q(now) : "NULL";
    out.push(
      `INSERT INTO keys (provider,name,key,status,http_status,tested_at,source_id) VALUES (${q(e.provider)},${q(e.name)},${q(e.key)},${q(status)},${http == null ? "NULL" : http},${tested},${q(e.id)});`,
    );
  });
  out.push("COMMIT;");

  // summary to stderr (no keys)
  let W = 0, U = 0, I = 0;
  const rows = Object.entries(summary).sort((a, b) => {
    const s = (x) => x.working + x.untested + x.invalid;
    return s(b[1]) - s(a[1]);
  });
  process.stderr.write("\n== provider: working / untested / dropped-invalid ==\n");
  for (const [p, s] of rows) {
    W += s.working; U += s.untested; I += s.invalid;
    process.stderr.write(`  ${p.padEnd(22)} ${String(s.working).padStart(3)} / ${String(s.untested).padStart(3)} / ${String(s.invalid).padStart(3)}\n`);
  }
  process.stderr.write(`  ${"TOTAL".padEnd(22)} ${String(W).padStart(3)} / ${String(U).padStart(3)} / ${String(I).padStart(3)}\n`);
  process.stderr.write(`  inserted rows: ${W + U}\n`);

  process.stdout.write(out.join("\n") + "\n");
}

main().catch((e) => { process.stderr.write(`ERROR: ${e.stack || e}\n`); process.exit(1); });
