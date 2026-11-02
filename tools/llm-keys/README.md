# llm-keys

Turn a gpg-encrypted 1Password archive export (`API_CREDENTIAL` / `LOGIN` /
`PASSWORD` / `SECURE_NOTE` items holding LLM API keys) into an **encrypted
SQLCipher database**, grouped by provider, with dead keys filtered out.

## What it does

1. **Decrypt** the gpg archive.
2. **Group** items by provider, normalizing spelling variants
   (`OpenAI`/`Openai`/`Open AI`, `Together AI`/`TogetherAI`/`ToghetherAI`,
   `xAI`/`Xai`/`Grok`, `Claude`/`ClaudeCode`/`Anthropic`, …).
3. **Live-test** LLM keys and classify:
   - `working` — provider returned `200`/`429`.
   - `untested` — no test endpoint (non-LLM providers, logins) or an
     ambiguous result (`5xx`/timeout).
   - dropped — provider returned `401`/`403` (invalid); not stored.

   Tested providers: OpenAI, Anthropic, Gemini, Together AI, Fireworks, xAI,
   Mistral, DeepSeek, Groq, Cerebras, OpenRouter, Cohere (GET `/models` or key
   endpoint); Perplexity, Voyage AI (POST auth-probe with a malformed body — a
   `401` vs `400` tells key-valid from key-invalid **without** billing a
   completion).
4. **Encrypt** the result into a SQLCipher DB.

Key material and the passphrase only travel through the pipe — nothing is
written to disk in plaintext and nothing is printed to the terminal.

## Usage

```bash
sudo apt install sqlcipher            # one-time
./build-db.sh "~/LLM API Keys-archive-YYYYMMDD.json.gpg" ~/llm-keys.db
```

The passphrase (for both the gpg archive and the SQLCipher DB) is read from the
keyring: `secret-tool lookup service op-vault-archive` (override the service
name with `SECRET_SERVICE=...`).

## Schema

```sql
CREATE TABLE keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT NOT NULL,           -- normalized provider name
  name        TEXT NOT NULL,           -- original 1Password item title
  key         TEXT NOT NULL,           -- the secret
  status      TEXT NOT NULL,           -- 'working' | 'untested'
  http_status INTEGER,                 -- last test HTTP status (NULL if untested)
  tested_at   TEXT,                    -- ISO timestamp of last test (NULL if untested)
  source_id   TEXT,                    -- 1Password item id, for traceability
  added_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Reading it back

```bash
sqlcipher ~/llm-keys.db
sqlite> PRAGMA key = '<passphrase>';
sqlite> SELECT provider, count(*) FROM keys GROUP BY provider ORDER BY 2 DESC;
sqlite> SELECT name, status FROM keys WHERE provider = 'OpenAI';
```

Any SQLCipher client (Node `@journeyapps/sqlcipher`, Python `sqlcipher3`, the
CLI) can open it with the same passphrase.
