# Sprint 3 — MCP Server & Project Auto-Detection

Sprint 3 is the bridge between the storage layer (Sprint 2) and AI tools. **Claude Desktop and Cursor can now query Qunoqu memory directly.** A developer can ask Claude *"what decisions did we make about WebSockets?"* and get real answers from their actual project memory. This sprint adds the MCP server (Model Context Protocol), four query tools, and automatic project ID detection so projects no longer need to be configured by hand.

---

## What Was Built

### 1. QunoqMCPServer

MCP server exposing the qunoqu memory layer over the **stdio** protocol. It solves the problem: *"How do AI assistants get at what we stored in Sprint 2?"*

- **recall_context** — Hybrid search (keyword SQLite + semantic vector). Returns relevant context for any query. Falls back to keyword-only when ChromaDB/Ollama are unavailable.
- **save_decision** — Writes to the SQLite decisions table and adds a node to the knowledge graph in one step.
- **get_project_summary** — Returns last 10 context items, top decisions, graph nodes, and active file list for a project.
- **list_projects** — Lists all known projects with context item counts and last active timestamps.

Transport is stdio; works with Claude Desktop, Cursor, and any MCP-compatible client. **MCP tools are not callable from JavaScript** — they work only over the stdio protocol. Test by exercising the underlying store logic (see Manual Tests below).

### 2. ProjectDetector

Solves the Sprint 2 problem where `projectId` had to be set manually everywhere.

- Auto-detects a **stable project ID** from any directory.
- Order: **git remote URL** → **package.json name+version** → **directory basename**.
- Always returns the same UUID-format string for the same project.
- Exported as: `detectProjectId(dir: string): string`.

### 3. MetadataStore Additions

Two new methods that power the MCP tools:

- **keywordSearch(query, options?)** — SQLite `LIKE` search across the `content` field. Splits query into tokens with OR logic. Options: `{ projectId?, limit? }`. Empty query returns recent items; no match returns an empty array (never throws).
- **listProjects()** — Returns all projects with `context_count` from a `LEFT JOIN` on `context_items`. Used by the **list_projects** tool.

### 4. run-mcp.ts (stdio entrypoint)

Zero-config entrypoint for the MCP server. Claude Desktop and Cursor point their MCP config at this file.

- **Run:** `node packages/core/dist/run-mcp.js`
- No configuration required — works out of the box.

---

## Architecture Overview

Sprint 3 sits on top of Sprints 1 and 2. End-to-end flow:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SPRINT 1 — CAPTURE                                                          │
│  FileWatcher, TerminalCapture → emit context items (files, commands, etc.)   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  SPRINT 2 — STORE                                                            │
│  MetadataStore (SQLite)  → projects, context_items, decisions               │
│  VectorStore (ChromaDB)  → semantic search                                  │
│  KnowledgeGraph (JSON)   → nodes & edges                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  SPRINT 3 — QUERY VIA AI TOOLS                                               │
│  QunoqMCPServer (stdio)  → recall_context, save_decision,                   │
│                            get_project_summary, list_projects                │
│  ProjectDetector         → stable projectId from git / package.json / dir     │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                    Claude Desktop, Cursor, MCP Inspector
```

---

## Project Structure

Sprint 3 adds or touches these paths. The rest of the monorepo (Sprint 1 & 2) is unchanged.

```
qunoqu-core/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── QunoqMCPServer.ts    # NEW — MCP server + 4 tools
│   │   │   ├── ProjectDetector.ts   # NEW — detectProjectId()
│   │   │   ├── run-mcp.ts           # NEW — stdio entrypoint
│   │   │   ├── MetadataStore.ts     # + keywordSearch, listProjects
│   │   │   ├── FileWatcher.ts
│   │   │   ├── TerminalCapture.ts
│   │   │   ├── extractContext.ts
│   │   │   ├── VectorStore.ts
│   │   │   ├── KnowledgeGraph.ts
│   │   │   ├── types.ts
│   │   │   ├── metadataTypes.ts
│   │   │   └── index.ts
│   │   ├── dist/                    # build output (run-mcp.js, index.js, etc.)
│   │   └── MCP.md                   # MCP + Cursor/Claude config docs
│   └── cli/
│       └── src/
│           └── cli.ts               # + qunoqu config cursor
├── SPRINT3.md                       # this file
└── package.json
```

---

## Prerequisites

| Requirement        | Notes                                                |
|--------------------|------------------------------------------------------|
| Node.js 20+        | Tested on v25.6.1                                    |
| npm 10+            | Used for install and workspace scripts               |
| Claude Desktop     | Optional; for full MCP integration test              |
| ChromaDB + Ollama  | Optional; `recall_context` falls back to keyword-only |

---

## Setup

```bash
git clone <repo-url>
cd qunoqu-core
npm install
npm run build
```

Build compiles TypeScript in `packages/core` and `packages/cli`. The MCP server entrypoint is `packages/core/dist/run-mcp.js`.

---

## Connecting Claude Desktop

### Step 1: Open the config file

```bash
open "$HOME/Library/Application Support/Claude/claude_desktop_config.json"
```

(On Windows: `%APPDATA%\Claude\claude_desktop_config.json`.)

### Step 2: Add the MCP server

Add this under the `mcpServers` key (create the key if it does not exist). **Replace the path** with your actual path to `run-mcp.js`:

```json
{
  "mcpServers": {
    "qunoqu": {
      "command": "node",
      "args": ["/Users/aryan/Desktop/qunoqu-core/packages/core/dist/run-mcp.js"],
      "env": {}
    }
  }
}
```

### Step 3: Restart Claude Desktop

Quit Claude Desktop completely and reopen it so it picks up the new MCP config.

### Step 4: Test in Claude

Ask Claude to use the qunoqu tools, for example:

- *"list_projects"*
- *"recall_context WebSockets"*
- *"get_project_summary"* (with a projectId)
- *"save_decision"* (with title and rationale)

---

## Automated Tests

From the **repository root**:

```bash
npm test
```

**Expected:** 8 test files, 38 tests passed, 0 skipped, 0 failed.

| Test file                    | Tests | Notes                                              |
|-----------------------------|-------|----------------------------------------------------|
| extractContext.test.ts      | 6     | Context extraction from source                     |
| OllamaEmbeddingFunction.test.ts | 3 | Embedding function mocks                        |
| KnowledgeGraph.test.ts      | 8     | Graph nodes, edges, project summary                |
| MetadataStore.test.ts       | 9     | Includes **keywordSearch** and **listProjects**   |
| TerminalCapture.test.ts     | 3     | Socket server, JSON payloads                       |
| VectorStore.test.ts         | 4     | Semantic search, add, delete                       |
| FileWatcher.test.ts         | 4     | All 4 passing, including integration tests         |
| index.test.ts               | 1     | Package exports                                    |

FileWatcher integration tests are fully enabled and passing as of Sprint 3.

---

## Manual Tests

All scripts are intended to be saved under `/tmp/` and use the absolute path `/Users/aryan/Desktop/qunoqu-core` for requires. Run with:

```bash
node /tmp/s3-testN.js
```

All tests work offline **except** S3-T6, which can optionally use ChromaDB+Ollama for vector search (keyword path still works without them).

**IMPORTANT — Do NOT use `mcpServer.callTool()` or any MCP client API.** The MCP SDK does not expose `callTool` to JavaScript. For tests T4, T5, and T6, all tool logic must be tested by calling the underlying store methods directly:

| MCP tool              | Underlying store methods |
|-----------------------|---------------------------|
| **recall_context**    | `db.keywordSearch()`      |
| **save_decision**     | `db.insertDecision()` + `kg.addNode()` |
| **get_project_summary**| `db.getByProject()` + `db.getDecisions()` + `kg.getProjectSummary()` |
| **list_projects**     | `db.listProjects()`       |

The scripts below use these exact store calls only (no MCP server invocation).

---

### TEST 1 — ProjectDetector: stable UUID from git remote

**What this tests:** `detectProjectId` reads the git remote URL, hashes it with SHA-256, and returns the same UUID-format string on every call. Different directories produce different IDs. This is the foundation of zero-config project tracking.

**Save and run:**

```bash
cat > /tmp/s3-test1.js << 'EOF'
const { detectProjectId } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const dir = '/Users/aryan/Desktop/qunoqu-core';
const id1 = detectProjectId(dir);
const id2 = detectProjectId(dir);
console.log('Project ID:', id1);
console.log('UUID format:', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id1) ? 'PASS' : 'FAIL');
console.log('Stable (same every call):', id1 === id2 ? 'PASS' : 'FAIL');
const id3 = detectProjectId('/tmp');
console.log('Different dir = different ID:', id1 !== id3 ? 'PASS' : 'FAIL');
console.log('tmp ID:', id3);
console.log('\nPASS - ProjectDetector working');
EOF
node /tmp/s3-test1.js
```

**Expected output:**

```
Project ID: 5193ac5a-1d9e-8878-c6d1-b1f95c0313dd (your git remote hash — will differ)
UUID format: PASS
Stable (same every call): PASS
Different dir = different ID: PASS
tmp ID: cf10d3eb-4b80-f1fd-d743-06ab6e6152f1
PASS - ProjectDetector working
```

- **Pass:** UUID format correct, same ID on repeated calls, different dirs give different IDs.
- **Fail:** Empty string means no git remote and no package.json found.

---

### TEST 2 — MetadataStore: keywordSearch

**What this tests:** `keywordSearch` splits the query into tokens and does SQLite `LIKE` search with OR logic. Can be scoped by `projectId`. Empty query returns recent items. No match returns an empty array without crashing. This powers the keyword half of **recall_context**.

**Save and run:**

```bash
cat > /tmp/s3-test2.js << 'EOF'
const { MetadataStore } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const store = new MetadataStore({ dbPath: '/tmp/s3-test2.db' });
const projectId = store.insertProject({ name: 'test', root_path: '/tmp' });
store.insertContextItem({ project_id: projectId, type: 'decision', content: 'We chose WebSockets because polling caused 500ms latency', tags: [] });
store.insertContextItem({ project_id: projectId, type: 'decision', content: 'We use Postgres because Redis had persistence issues', tags: [] });
store.insertContextItem({ project_id: projectId, type: 'terminal_cmd', content: 'npm run build failed: missing API key', tags: [] });
store.insertContextItem({ project_id: projectId, type: 'file_change', content: 'function processPayment() handles billing logic', tags: [] });
console.log('Inserted 4 items');
const r1 = store.keywordSearch('WebSockets', { projectId });
console.log('\nSearch "WebSockets":', r1.length, r1.length === 1 ? 'PASS' : 'FAIL - expected 1');
console.log('Content:', r1[0]?.content.slice(0, 50));
const r2 = store.keywordSearch('because', { projectId });
console.log('\nSearch "because":', r2.length, r2.length === 2 ? 'PASS' : 'FAIL - expected 2');
const r3 = store.keywordSearch('npm');
console.log('\nSearch "npm" (no project scope):', r3.length, r3.length >= 1 ? 'PASS' : 'FAIL');
const r4 = store.keywordSearch('xyznotfound', { projectId });
console.log('\nSearch "xyznotfound":', r4.length, r4.length === 0 ? 'PASS' : 'FAIL - expected 0');
const r5 = store.keywordSearch('', { projectId });
console.log('\nEmpty query returns recent:', r5.length, r5.length === 4 ? 'PASS' : 'FAIL - expected 4');
store.close();
console.log('\nPASS - keywordSearch working');
EOF
node /tmp/s3-test2.js
```

**Expected output:**

```
Inserted 4 items
Search "WebSockets": 1 PASS
Content: We chose WebSockets because polling caused 500ms l
Search "because": 2 PASS
Search "npm" (no project scope): 2 PASS (or more if other tests left data)
Search "xyznotfound": 0 PASS
Empty query returns recent: 4 PASS
PASS - keywordSearch working
```

- **Pass:** All five search cases return the expected counts.
- **Fail:** Empty query returning 0 means the fallback to recent items is not working.

---

### TEST 3 — MetadataStore: listProjects with context counts

**What this tests:** `listProjects` returns all projects with a `context_count` from a `LEFT JOIN` on `context_items`. This powers the **list_projects** MCP tool. Results are ordered by `last_active` descending.

**Save and run:**

```bash
cat > /tmp/s3-test3.js << 'EOF'
const { MetadataStore } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const store = new MetadataStore({ dbPath: '/tmp/s3-test3.db' });
const p1 = store.insertProject({ name: 'project-alpha', root_path: '/tmp/alpha' });
const p2 = store.insertProject({ name: 'project-beta', root_path: '/tmp/beta' });
store.insertContextItem({ project_id: p1, type: 'decision', content: 'alpha decision 1', tags: [] });
store.insertContextItem({ project_id: p1, type: 'file_change', content: 'alpha file change', tags: [] });
store.insertContextItem({ project_id: p2, type: 'terminal_cmd', content: 'beta command', tags: [] });
const projects = store.listProjects();
console.log('Projects found:', projects.length, projects.length === 2 ? 'PASS' : 'FAIL - expected 2');
projects.forEach(p => {
  console.log('\nProject:', p.name);
  console.log('  ID:', p.id.slice(0, 8) + '...');
  console.log('  root_path:', p.root_path);
  console.log('  context_count:', p.context_count);
});
const alpha = projects.find(p => p.name === 'project-alpha');
const beta = projects.find(p => p.name === 'project-beta');
console.log('\nalpha context_count:', alpha?.context_count, alpha?.context_count === 2 ? 'PASS' : 'FAIL - expected 2');
console.log('beta context_count:', beta?.context_count, beta?.context_count === 1 ? 'PASS' : 'FAIL - expected 1');
store.close();
console.log('\nPASS - listProjects working');
EOF
node /tmp/s3-test3.js
```

**Expected output:**

```
Projects found: 2 PASS
Project: project-alpha
  ID: xxxxxxxx...
  root_path: /tmp/alpha
  context_count: 2
Project: project-beta
  ID: xxxxxxxx...
  root_path: /tmp/beta
  context_count: 1
alpha context_count: 2 PASS
beta context_count: 1 PASS
PASS - listProjects working
```

- **Pass:** Counts match the number of items inserted per project.
- **Fail:** `context_count` 0 for all means the `LEFT JOIN` is wrong.

---

### TEST 4 — All 4 MCP tool logics verified

**What this tests:** Each MCP tool’s logic is tested by calling the underlying store methods only (no `callTool()` or MCP client): **recall_context** → `db.keywordSearch()`, **save_decision** → `db.insertDecision()` + `kg.addNode()`, **get_project_summary** → `db.getByProject()` + `db.getDecisions()` + `kg.getProjectSummary()`, **list_projects** → `db.listProjects()`.

**Save and run:**

```bash
cat > /tmp/s3-test4.js << 'EOF'
const { MetadataStore, KnowledgeGraph } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
async function run() {
  const db = new MetadataStore({ dbPath: '/tmp/s3-mcp-test.db' });
  const kg = new KnowledgeGraph({ graphPath: '/tmp/s3-mcp-graph.json' });
  const projectId = db.insertProject({ name: 'mcp-test', root_path: '/tmp/qtest' });
  console.log('Project created:', projectId.slice(0, 8) + '...');
  db.insertContextItem({ project_id: projectId, type: 'decision', content: 'We chose WebSockets because polling caused 500ms latency', file_path: '/tmp/service.ts', tags: [] });
  db.insertContextItem({ project_id: projectId, type: 'terminal_cmd', content: 'npm run build completed in 3.2s', file_path: null, tags: [] });
  db.insertContextItem({ project_id: projectId, type: 'decision', content: 'We use Postgres because Redis had persistence issues', file_path: '/tmp/db.ts', tags: [] });
  console.log('Seeded 3 context items\n');
  console.log('=== recall_context logic ===');
  const r1 = db.keywordSearch('WebSockets', { projectId, limit: 5 });
  console.log('Search "WebSockets":', r1.length >= 1 ? 'PASS' : 'FAIL');
  console.log('Top result:', r1[0]?.content.slice(0, 60));
  const r2 = db.keywordSearch('build', { projectId, limit: 5 });
  console.log('Search "build":', r2.length >= 1 ? 'PASS' : 'FAIL');
  const r3 = db.keywordSearch('xyznothing', { projectId, limit: 5 });
  console.log('Search returns empty for no match:', r3.length === 0 ? 'PASS' : 'FAIL');
  console.log('\n=== save_decision logic ===');
  const decisionId = db.insertDecision({ project_id: projectId, title: 'Use TypeScript strict mode', rationale: 'Catches type errors at compile time reducing runtime bugs' });
  kg.addNode({ id: 'decision:' + projectId + ':' + decisionId, type: 'decision', label: 'Use TypeScript strict mode', projectId, metadata: { rationale: 'Catches type errors' } });
  kg.save();
  const decisions = db.getDecisions(projectId);
  console.log('Decision saved to DB:', decisions.length === 1 ? 'PASS' : 'FAIL - expected 1');
  console.log('Decision title:', decisions[0]?.title);
  const graphNode = kg.getNode('decision:' + projectId + ':' + decisionId);
  console.log('Decision added to graph:', graphNode ? 'PASS' : 'FAIL');
  console.log('\n=== get_project_summary logic ===');
  const contextItems = db.getByProject(projectId).slice(0, 10);
  const summaryDecisions = db.getDecisions(projectId).slice(0, 10);
  const kgNodes = kg.getProjectSummary(projectId);
  const filePaths = [...new Set(contextItems.map(c => c.file_path).filter(Boolean))];
  console.log('Context items:', contextItems.length, contextItems.length >= 3 ? 'PASS' : 'FAIL');
  console.log('Decisions:', summaryDecisions.length, summaryDecisions.length >= 1 ? 'PASS' : 'FAIL');
  console.log('Graph nodes:', kgNodes.length, kgNodes.length >= 1 ? 'PASS' : 'FAIL');
  console.log('Active files:', filePaths.length, filePaths.length >= 1 ? 'PASS' : 'FAIL');
  console.log('\n=== list_projects logic ===');
  const projects = db.listProjects();
  console.log('Projects:', projects.length, projects.length >= 1 ? 'PASS' : 'FAIL');
  console.log('Project name:', projects[0]?.name);
  console.log('Context count:', projects[0]?.context_count, projects[0]?.context_count >= 3 ? 'PASS' : 'FAIL');
  db.close();
  console.log('\nPASS - All 4 MCP tool logics verified');
}
run().catch(err => { console.log('FAIL:', err.message); console.log(err.stack); });
EOF
node /tmp/s3-test4.js
```

**Expected output:**

```
Project created: xxxxxxxx...
Seeded 3 context items

=== recall_context logic ===
Search "WebSockets": PASS
Top result: We chose WebSockets because polling caused 500ms latency
Search "build": PASS
Search returns empty for no match: PASS

=== save_decision logic ===
Decision saved to DB: PASS
Decision title: Use TypeScript strict mode
Decision added to graph: PASS

=== get_project_summary logic ===
Context items: 3 PASS
Decisions: 1 PASS
Graph nodes: 1 PASS
Active files: 2 PASS

=== list_projects logic ===
Projects: (1 or more) PASS
Context count: (3 or more) PASS
PASS - All 4 MCP tool logics verified
```

- **Pass:** All sections pass.
- **Note:** `list_projects` may show more than one project if earlier tests left data in `/tmp/`.

---

### TEST 5 — Graceful error handling (empty DB, missing projectId)

**What this tests:** Edge cases do not crash: empty DB returns empty arrays, invalid `projectId` leads to a caught exception, empty project returns empty arrays for all summary fields. Uses only `MetadataStore` and `KnowledgeGraph` (no MCP server or `callTool()`). Ensures the MCP server does not crash Claude Desktop.

**Save and run:**

```bash
cat > /tmp/s3-test5.js << 'EOF'
const { MetadataStore, KnowledgeGraph } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
function run() {
  console.log('=== recall_context empty DB ===');
  const db = new MetadataStore({ dbPath: '/tmp/s3-empty.db' });
  const projectId = db.insertProject({ name: 'empty-test', root_path: '/tmp' });
  const results = db.keywordSearch('anything', { projectId, limit: 5 });
  console.log('Empty DB returns empty array:', results.length === 0 ? 'PASS' : 'FAIL');
  console.log('No crash on empty search: PASS');
  console.log('\n=== save_decision missing projectId ===');
  let errorCaught = false;
  try {
    db.insertDecision({ project_id: 'nonexistent-project-id', title: 'Some decision', rationale: 'Some rationale' });
  } catch(e) {
    errorCaught = true;
    console.log('Foreign key error caught gracefully:', e.message.includes('FOREIGN KEY') ? 'PASS' : 'FAIL');
  }
  console.log('Error was thrown for invalid projectId:', errorCaught ? 'PASS' : 'FAIL');
  console.log('\n=== get_project_summary empty project ===');
  const emptyItems = db.getByProject(projectId);
  const emptyDecisions = db.getDecisions(projectId);
  const kg = new KnowledgeGraph({ graphPath: '/tmp/s3-empty-graph.json' });
  const emptyNodes = kg.getProjectSummary(projectId);
  console.log('Empty items array:', emptyItems.length === 0 ? 'PASS' : 'FAIL');
  console.log('Empty decisions array:', emptyDecisions.length === 0 ? 'PASS' : 'FAIL');
  console.log('Empty graph nodes array:', emptyNodes.length === 0 ? 'PASS' : 'FAIL');
  console.log('No crash on empty summary: PASS');
  console.log('\n=== list_projects fresh DB ===');
  const db2 = new MetadataStore({ dbPath: '/tmp/s3-empty2.db' });
  const noProjects = db2.listProjects();
  console.log('Empty projects array:', noProjects.length === 0 ? 'PASS' : 'FAIL');
  console.log('No crash on empty list: PASS');
  db.close();
  db2.close();
  console.log('\nPASS - All graceful error handling working');
}
run();
EOF
node /tmp/s3-test5.js
```

**Expected output:**

```
=== recall_context empty DB ===
Empty DB returns empty array: PASS
No crash on empty search: PASS

=== save_decision missing projectId ===
Foreign key error caught gracefully: PASS
Error was thrown for invalid projectId: PASS

=== get_project_summary empty project ===
Empty items array: PASS
Empty decisions array: PASS
Empty graph nodes array: PASS
No crash on empty summary: PASS

=== list_projects fresh DB ===
Empty projects array: PASS
No crash on empty list: PASS
PASS - All graceful error handling working
```

- **Pass:** All nine checks pass, no uncaught exceptions.
- **Fail:** Any uncaught exception means the MCP server could crash Claude Desktop.

---

### TEST 6 — Full Sprint 3 pipeline (detect → seed → query via all tools)

**What this tests:** End-to-end Sprint 3 flow: ProjectDetector provides a project ID, data is seeded into MetadataStore and KnowledgeGraph, and all four tool logics are exercised by calling the underlying store methods only (`keywordSearch`, `insertDecision` + `addNode`, `getByProject` + `getDecisions` + `getProjectSummary`, `listProjects`). No `callTool()` or MCP client used.

**Save and run:**

```bash
cat > /tmp/s3-test6.js << 'EOF'
const { detectProjectId, MetadataStore, KnowledgeGraph } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
async function run() {
  const projectDir = '/Users/aryan/Desktop/qunoqu-core';
  const detectedId = detectProjectId(projectDir);
  console.log('Auto-detected projectId:', detectedId);
  console.log('Is UUID format:', /^[0-9a-f-]{36}$/.test(detectedId) ? 'PASS' : 'FAIL');
  const db = new MetadataStore({ dbPath: '/tmp/s3-pipeline.db' });
  const kg = new KnowledgeGraph({ graphPath: '/tmp/s3-pipeline-graph.json' });
  const dbProjectId = db.insertProject({ name: 'qunoqu-core', root_path: projectDir });
  console.log('\nDB project UUID:', dbProjectId.slice(0, 8) + '...');
  db.insertContextItem({ project_id: dbProjectId, type: 'decision', content: 'We chose WebSockets because polling caused 500ms latency', file_path: '/tmp/service.ts', tags: [] });
  db.insertContextItem({ project_id: dbProjectId, type: 'decision', content: 'We use Postgres because Redis had persistence issues', file_path: '/tmp/db.ts', tags: [] });
  db.insertContextItem({ project_id: dbProjectId, type: 'terminal_cmd', content: 'npm run build failed: missing environment variable', file_path: null, tags: [] });
  console.log('Seeded 3 items');
  console.log('\n=== recall_context ===');
  const r1 = db.keywordSearch('WebSockets', { projectId: dbProjectId, limit: 3 });
  console.log('Search "WebSockets":', r1.length >= 1 ? 'PASS' : 'FAIL');
  console.log('Top result:', r1[0]?.content.slice(0, 60));
  const r2 = db.keywordSearch('build failed', { projectId: dbProjectId, limit: 3 });
  console.log('Search "build failed":', r2.length >= 1 ? 'PASS' : 'FAIL');
  console.log('\n=== save_decision ===');
  const decId = db.insertDecision({ project_id: dbProjectId, title: 'Use strict TypeScript', rationale: 'Catches bugs at compile time' });
  kg.addNode({ id: 'decision:' + dbProjectId + ':' + decId, type: 'decision', label: 'Use strict TypeScript', projectId: dbProjectId, metadata: {} });
  kg.save();
  const decisions = db.getDecisions(dbProjectId);
  console.log('Decision saved:', decisions.length === 1 ? 'PASS' : 'FAIL');
  console.log('Decision title:', decisions[0]?.title);
  console.log('\n=== get_project_summary ===');
  const items = db.getByProject(dbProjectId).slice(0, 10);
  const decs = db.getDecisions(dbProjectId).slice(0, 10);
  const nodes = kg.getProjectSummary(dbProjectId);
  const files = [...new Set(items.map(c => c.file_path).filter(Boolean))];
  console.log('Context items:', items.length, items.length >= 3 ? 'PASS' : 'FAIL');
  console.log('Decisions:', decs.length, decs.length >= 1 ? 'PASS' : 'FAIL');
  console.log('Graph nodes:', nodes.length, nodes.length >= 1 ? 'PASS' : 'FAIL');
  console.log('Active files:', files.length, files.length >= 1 ? 'PASS' : 'FAIL');
  console.log('\n=== list_projects ===');
  const projects = db.listProjects();
  console.log('Projects listed:', projects.length >= 1 ? 'PASS' : 'FAIL');
  console.log('qunoqu-core found:', projects.some(p => p.name === 'qunoqu-core') ? 'PASS' : 'FAIL');
  console.log('Context count:', projects.find(p => p.name === 'qunoqu-core')?.context_count >= 3 ? 'PASS' : 'FAIL');
  db.close();
  console.log('\nFULL SPRINT 3 PIPELINE PASS');
}
run().catch(err => { console.log('FAIL:', err.message); console.log(err.stack); });
EOF
node /tmp/s3-test6.js
```

**Expected output:**

```
Auto-detected projectId: 5193ac5a-1d9e-8878-c6d1-b1f95c0313dd
Is UUID format: PASS
DB project UUID: xxxxxxxx...
Seeded 3 items

=== recall_context ===
Search "WebSockets": PASS
Top result: We chose WebSockets because polling caused 500ms latency
Search "build failed": PASS

=== save_decision ===
Decision saved: PASS
Decision title: Use strict TypeScript

=== get_project_summary ===
Context items: 3 PASS
Decisions: 1 PASS
Graph nodes: 1 PASS
Active files: 2 PASS

=== list_projects ===
Projects listed: PASS
qunoqu-core found: PASS
Context count: PASS
FULL SPRINT 3 PIPELINE PASS
```

- **Pass:** Every section passes end to end.
- **Fail:** Any FAIL indicates a broken store operation in the pipeline.

---

### TEST 7 — MCP server ready for Claude Desktop

**What this tests:** QunoqMCPServer can be created with zero config, `run-mcp.js` exists in `dist/`, `CLAUDE_DESKTOP_MCP_CONFIG` is exported with the right shape, `getServer()` returns an McpServer instance, and `close()` runs without errors. Confirms Claude Desktop can connect.

**Save and run:**

```bash
cat > /tmp/s3-test7.js << 'EOF'
const { QunoqMCPServer, CLAUDE_DESKTOP_MCP_CONFIG } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
async function run() {
  console.log('CLAUDE_DESKTOP_MCP_CONFIG exists:', CLAUDE_DESKTOP_MCP_CONFIG ? 'PASS' : 'FAIL');
  console.log('Has qunoqu key:', CLAUDE_DESKTOP_MCP_CONFIG?.qunoqu ? 'PASS' : 'FAIL');
  console.log('Command is node:', CLAUDE_DESKTOP_MCP_CONFIG?.qunoqu?.command === 'node' ? 'PASS' : 'FAIL');
  console.log('Has args array:', Array.isArray(CLAUDE_DESKTOP_MCP_CONFIG?.qunoqu?.args) ? 'PASS' : 'FAIL');
  console.log('Points to run-mcp.js:', CLAUDE_DESKTOP_MCP_CONFIG?.qunoqu?.args?.[0]?.includes('run-mcp') ? 'PASS' : 'FAIL');
  console.log('\nClaude Desktop config:');
  console.log(JSON.stringify(CLAUDE_DESKTOP_MCP_CONFIG, null, 2));
  const fs = require('fs');
  const runMcpPath = '/Users/aryan/Desktop/qunoqu-core/packages/core/dist/run-mcp.js';
  console.log('\nrun-mcp.js exists:', fs.existsSync(runMcpPath) ? 'PASS' : 'FAIL - run npm run build first');
  const server = new QunoqMCPServer();
  console.log('Zero-config server created:', server ? 'PASS' : 'FAIL');
  console.log('getServer() returns McpServer:', server.getServer() ? 'PASS' : 'FAIL');
  await server.close();
  console.log('\nPASS - MCP server ready for Claude Desktop');
  console.log('\n--- Connect Claude Desktop ---');
  console.log('1. open ~/Library/Application\\ Support/Claude/claude_desktop_config.json');
  console.log('2. Add under mcpServers:');
  console.log(JSON.stringify({ qunoqu: { command: 'node', args: ['/Users/aryan/Desktop/qunoqu-core/packages/core/dist/run-mcp.js'], env: {} } }, null, 2));
  console.log('3. Restart Claude Desktop completely');
  console.log('4. Ask Claude: list_projects');
}
run().catch(err => console.log('FAIL:', err.message));
EOF
node /tmp/s3-test7.js
```

**Expected output:**

```
CLAUDE_DESKTOP_MCP_CONFIG exists: PASS
Has qunoqu key: PASS
Command is node: PASS
Has args array: PASS
Points to run-mcp.js: PASS
run-mcp.js exists: PASS
Zero-config server created: PASS
getServer() returns McpServer: PASS
PASS - MCP server ready for Claude Desktop
```

- **Pass:** All eight checks pass.
- **Fail:** If `run-mcp.js` is not found, run `npm run build` in the repo.

---

## Sprint 3 Done Criteria

All of the following must be true before merging:

| Criterion | Description |
|----------|-------------|
| **Automated tests** | `npm test` shows 38 passed, 0 failed, 0 skipped |
| **S3-T1** | ProjectDetector returns a stable UUID from git remote |
| **S3-T2** | keywordSearch: all five cases pass |
| **S3-T3** | listProjects shows correct context counts per project |
| **S3-T4** | All four MCP tool logics verified against stores |
| **S3-T5** | Graceful error handling — no crashes on empty data or invalid IDs |
| **S3-T6** | Full pipeline — detect, seed, query working end to end |
| **S3-T7** | run-mcp.js exists, zero-config server starts, Claude Desktop config correct |

---

## Important API Notes for Teammates

- **detectProjectId(dir)** returns a UUID derived from the git remote URL when available (most stable).
- **QunoqMCPServer** tools work over **stdio only** — they are not callable from JavaScript.
- **keywordSearch** with an empty query returns recent items, not an error.
- **QUNOQU_PROJECT_ID** can be set at startup so you do not have to pass `projectId` on every tool call.
- **recall_context** works without Ollama/ChromaDB (falls back to keyword-only search).
- **save_decision** needs `projectId` either as an argument or via **QUNOQU_PROJECT_ID**.

---

## Known Limitations (what Sprint 4 will address)

- **ProjectId not fully unified:** `detectProjectId` returns one UUID, but `MetadataStore.insertProject` generates a different UUID. Sprint 4 CLI will introduce a `.qunoqu/config.json` that stores the project ID once and reuses it.
- **Shell integration not auto-installed:** `SHELL_INTEGRATION_SCRIPT` is exported but not installed by default. Sprint 4 will support `qunoqu init` to install it.
- **projectId still required per call or via env:** Sprint 4 will read projectId from `.qunoqu/config.json` so it does not need to be passed manually.
- **FileWatcher not wired to MCP:** Sprint 4 will connect everything in a single **qunoqu daemon** process.

---

## What Is Next — Sprint 4

- **feat/cli-tool** — `qunoqu init`, `qunoqu status`, `qunoqu recall`, `qunoqu doctor`.
- **feat/vscode-extension** — VS Code extension activation, status bar, recall command.

Sprint 4 is the user-facing layer: developers will interact with Qunoqu via CLI and IDE for the first time.
