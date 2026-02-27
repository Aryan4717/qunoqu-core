# Sprint 5 — Privacy Layer & REST API

Sprint 5 makes Qunoqu safe to use on real projects (a **privacy filter** stops secrets and PII from leaking into memory) and opens it up to **any AI tool via REST** — not just Claude/Cursor via MCP. You get path filtering, PII redaction, content truncation, and a Bearer-authenticated HTTP API on port 7384 for ChatGPT custom actions, DeepSeek, or any HTTP client.

---

## What Was Built

### 1. PrivacyFilter (`packages/core/src/PrivacyFilter.ts`)

Runs on every **ContextItem** **before** it reaches MetadataStore or VectorStore.

| Job | Description |
|-----|-------------|
| **Path filtering** | Drops files matching ignore patterns (`.env`, `*.key`, `*secret*`, `node_modules/*`, `dist/*`, `.git/*`, etc.). |
| **PII scrubbing** | Finds and replaces API keys, JWTs, private keys, passwords, credit cards with `[REDACTED]`. |
| **Content truncation** | Cuts any single item to a maximum of 2000 characters. |

Logs what was filtered (reason and file path, **never** the actual secret) to **`~/.qunoqu/privacy.log`**.

Supports a **`.qunoqu-ignore`** file in the project root (gitignore-style) for custom ignore rules.

**Usage:**

```ts
// Option 1: Explicit filter instance
const filter = new PrivacyFilter({ projectRoot: "/my/project" });
const safe = filter.filter(item); // null if dropped, cleaned item if ok

// Option 2: One-liner (default filter)
const safe = filterContextItem(item, projectRoot);
```

**Rule:** Always run items through `filterContextItem()` (or `filter.filter()`) before calling `insertContextItem()` or `addContext()`. The FileWatcher and VS Code extension are already wired to do this.

---

### 2. REST API Server (`packages/core/src/server.ts`) — port 7384

Express server with **Bearer token** auth. Purpose: let ChatGPT custom actions, DeepSeek, and any HTTP client query Qunoqu memory — not just Claude/Cursor via MCP.

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | Required | Returns `status`, `version`, `memoriesCount`, `ollamaStatus`. |
| `GET /openapi.json` | Required | OpenAPI 3.0 spec for ChatGPT custom action setup. |
| `GET /context?q=query&projectId=id&topK=5` | Required | Hybrid keyword + semantic search (same logic as MCP `recall_context`). |
| `POST /decision` | Required | Body: `{ title, rationale, projectId }`. Saves to SQLite and KnowledgeGraph. |
| `GET /summary/:projectId` | Required | Returns last 10 items, decisions, graph nodes, total stats. |

All requests require: **`Authorization: Bearer <token>`**.

- **Default port:** 7384. Override with **`QUNOQU_API_PORT`**.
- **Programmatic use:** `createApp(options)` for testing or mounting; `startServer(options)` to listen.

---

### 3. API Token — `~/.qunoqu/api-token`

Auto-generated on first server start. A 64-character random hex string.

- Stored at **`~/.qunoqu/api-token`**. Stable — same token returned on every call after first generation.
- **Exported helpers:**
  - `ensureApiToken(path?)` — read existing or generate and write token.
  - `getApiTokenPath(options?)` — returns the token file path.

No manual setup. Run the server once and the token exists.

---

### 4. REST server entrypoint — `packages/core/src/run-server.ts`

Start with:

```bash
node packages/core/dist/run-server.js
```

Or via CLI:

```bash
qunoqu server start
```

Prints the port, token file path, and reminder to use Bearer auth. Writes PID to `~/.qunoqu/qunoqu-api.pid` for `qunoqu server stop`. Port is configurable via **`QUNOQU_API_PORT`**.

---

## Integration Test (`packages/core/src/e2e.integration.test.ts`)

E2E test covering the full **capture → recall** pipeline:

1. Init project (temp dir, SQLite, config).
2. Simulate file save with the decision comment (*We chose WebSockets over polling…*).
3. Extract context and store in SQLite + mocked VectorStore.
4. Recall by keyword and semantic search; assert decision is found with relevance score ≥ 0.7.
5. Assert REST **GET /context?q=websockets** returns the same item.

Ollama and ChromaDB are fully mocked so the test runs offline with no external services.

---

## Full System Architecture (Sprints 1–5)

```
Developer writes code / runs terminal commands
        ↓
FileWatcher + TerminalCapture (Sprint 1) — capture
        ↓
PrivacyFilter (Sprint 5) — drop secrets, redact PII  ← NEW
        ↓
MetadataStore + VectorStore + KnowledgeGraph (Sprint 2) — store
        ↓
┌─────────────────────────────────────────────────────────────────┐
│  QunoqMCPServer (Sprint 3) — Claude Desktop, Cursor              │
│  REST API Server (Sprint 5) — ChatGPT, DeepSeek, any HTTP client │  ← NEW
└─────────────────────────────────────────────────────────────────┘
        ↓
CLI: qunoqu init / status / recall / doctor / server start|stop (Sprint 4)
```

---

## How to Start the REST Server

```bash
npm run build
node packages/core/dist/run-server.js
```

Or from the CLI (after `npm run build` in the repo and `qunoqu` on PATH):

```bash
qunoqu server start
```

**Example startup output:**

```
Qunoqu REST API listening on http://localhost:7384
Token file: ~/.qunoqu/api-token
```

**Read the token:**

```bash
cat ~/.qunoqu/api-token
```

**Example `curl` commands** (replace `YOUR_TOKEN` with the value from `~/.qunoqu/api-token`):

```bash
# Health
curl -s -H "Authorization: Bearer YOUR_TOKEN" http://localhost:7384/health | jq

# OpenAPI spec
curl -s -H "Authorization: Bearer YOUR_TOKEN" http://localhost:7384/openapi.json | jq

# Context search
curl -s -H "Authorization: Bearer YOUR_TOKEN" "http://localhost:7384/context?q=websockets&projectId=YOUR_PROJECT_ID&topK=5" | jq

# Save decision
curl -s -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Use WebSockets","rationale":"Latency","projectId":"YOUR_PROJECT_ID"}' \
  http://localhost:7384/decision | jq

# Project summary
curl -s -H "Authorization: Bearer YOUR_TOKEN" "http://localhost:7384/summary/YOUR_PROJECT_ID" | jq
```

---

## How to Use PrivacyFilter

**Two usage patterns:**

```ts
import { PrivacyFilter, filterContextItem } from "@qunoqu/core";

// 1. One-off with project root
const cleaned = filterContextItem(item, "/path/to/project");
if (cleaned) {
  metadataStore.insertContextItem({ ... });
}

// 2. Reusable filter instance
const filter = new PrivacyFilter({ projectRoot: "/path/to/project" });
const cleaned = filter.filter(item);
```

**`.qunoqu-ignore`** in project root (gitignore-style):

```gitignore
# Example .qunoqu-ignore
*.local
config/secrets/
internal/
```

**Privacy log:** `~/.qunoqu/privacy.log` — one line per action (e.g. `path_ignored`, `content_redacted`, `content_truncated`) with file path or context, never the secret content.

---

## Connecting to ChatGPT

1. **Start the REST server:** `qunoqu server start` or `node packages/core/dist/run-server.js`.
2. **Get the token:** `cat ~/.qunoqu/api-token`.
3. In ChatGPT, create a **custom action** (or plugin) pointing to your API:
   - **Spec URL:** `http://localhost:7384/openapi.json` (or your public URL if you expose it).
   - **Auth:** Bearer token (paste the value from step 2).
4. If ChatGPT cannot reach localhost, expose the server with **ngrok** (or similar) and use the public URL for the spec and requests.

---

## Known Limitations

| Limitation | Note |
|------------|------|
| REST server not auto-started | Must run manually; a future daemon (Sprint 6) can auto-start it. |
| No HTTPS | Localhost only; use ngrok or a reverse proxy for remote access. |
| PII patterns | Regexes cover common cases (API keys, JWTs, passwords, credit cards); not exhaustive. Use `.qunoqu-ignore` for file-level exclusions. |
| Token on disk | Token is in `~/.qunoqu/api-token`; protect that file on shared machines. |

---

## What’s Next — Sprint 6

- **Daemon process** that auto-starts FileWatcher, TerminalCapture, and the REST server (e.g. on boot or login).
- **`qunoqu daemon start` / `qunoqu daemon stop`** in the CLI.
- Optional: PrivacyFilter already wired at the storage boundary (FileWatcher + extension); daemon can reuse the same pipeline.
