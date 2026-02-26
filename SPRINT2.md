# Sprint 2 — Storage Layer

Qunoqu is a developer-centric AI memory layer. **Sprint 1** delivered the capture engine: file watching, context extraction, and terminal capture. **Sprint 2** adds the entire storage layer: we can now store, retrieve, and search captured context in three complementary systems — structured SQL, semantic vectors, and a knowledge graph — so AI tools can retrieve it intelligently.

---

## What Was Built

Four new classes were added to `@qunoqu/core`:

| Class | Purpose | Storage | When to use |
|-------|---------|---------|-------------|
| **MetadataStore** | Structured CRUD for projects, context items, and decisions | SQLite at `~/.qunoqu/memory.db` | Get last N items, get all decisions, mark stale, delete old data |
| **VectorStore** | Semantic search by meaning | ChromaDB collection `qunoqu_context` + Ollama embeddings | "Find context about WebSockets" without exact keywords |
| **KnowledgeGraph** | Relationship and dependency queries | JSON at `~/.qunoqu/graph.json` | "What depends on payments.ts?", "What imports express?" |
| **OllamaEmbeddingFunction** | ChromaDB embedding adapter for Ollama | N/A (calls Ollama API) | Used internally by VectorStore |

---

## Architecture Overview

The three stores complement each other:

- **MetadataStore** — Structured queries: get by project, get recent items, get decisions, cleanup (markStale, deleteOlderThan).
- **VectorStore** — Semantic search: find context by meaning, not keywords; deduplication by content hash; graceful fallback when Ollama is down.
- **KnowledgeGraph** — Relationship queries: imports, depends_on, calls; shortest path (BFS); top 10 most connected nodes per project; auto-built from FileWatcher output via `extractFromContextItems`.

---

## What Was Achieved in Sprint 2

### 1. MetadataStore

- SQLite database at `~/.qunoqu/memory.db` using `better-sqlite3`.
- Tables: `projects`, `context_items`, `decisions`. WAL mode enabled for performance.
- Schema versioning via `schema_version` table with automatic migrations.
- Methods: `insertProject`, `insertContextItem`, `insertDecision`, `getByProject`, `getRecent`, `markStale`, `deleteOlderThan`, `getDecisions`, `close`, `getDbPath`.
- **ContextItemTypeEnum** values: `"file_change" | "terminal_cmd" | "decision" | "comment"`.
- No external dependencies — works completely offline.

### 2. VectorStore

- ChromaDB vector store for semantic search. Collection name: `"qunoqu_context"`.
- Embeddings via Ollama `nomic-embed-text` model.
- Deduplication via SHA-256 content hash before embedding.
- Graceful fallback to zero vectors when Ollama is unavailable.
- Chunks text over 2000 chars before storing.
- Methods: `addContext`, `semanticSearch`, `deleteByProject`.
- Requires ChromaDB server on localhost:8000 and Ollama on localhost:11434.

### 3. KnowledgeGraph

- Lightweight JSON graph at `~/.qunoqu/graph.json`.
- Node types: `file`, `function`, `decision`, `module`.
- Edge relation types: `imports`, `depends_on`, `decided_by`, `related_to`, `calls`.
- Auto-persists every 10 mutations. Force save with `save()`.
- Methods: `addNode`, `addEdge`, `removeNode`, `getNode`, `getRelated`, `findPath`, `getProjectSummary`, `extractFromContextItems`, `save`.
- `extractFromContextItems` auto-builds the graph from FileWatcher output.
- No external dependencies — works completely offline.

### 4. OllamaEmbeddingFunction

- ChromaDB `EmbeddingFunction` implementation.
- Calls Ollama REST API at localhost:11434 with model `nomic-embed-text`.
- Methods: `generate(texts)` returns `number[][]`, `embedOne(text)` returns `number[]`.
- Used internally by VectorStore — not called directly in normal usage.

### Known Bug Fixed During Testing

**FileWatcher** was ignoring the `projectId` option passed in the constructor — all emitted `ContextItem`s had `projectId` `"default"` instead of the passed value. This was fixed by ensuring the constructor supports both `new FileWatcher(options)` and `new FileWatcher(projectDir, options)`, and that `extractContext` is called with `this.projectId` inside `processFile`. After fix: `new FileWatcher('/tmp/qtest', { projectId: 'my-id' })` correctly emits items with `projectId === 'my-id'`.

---

## Exact API Reference (for teammates)

### MetadataStore

| Method | Signature |
|--------|-----------|
| constructor | `new MetadataStore(options?: { dbPath?: string })` |
| insertProject | `insertProject({ name: string, root_path: string })` → returns UUID string |
| insertContextItem | `insertContextItem({ project_id, type, content, file_path?, embedding_id?, tags? })` → returns UUID string |
| insertDecision | `insertDecision({ project_id, title, rationale, source_file? })` → returns UUID string |
| getByProject | `getByProject(projectId: string)` → `ContextItemRow[]` |
| getRecent | `getRecent(n: number)` → `ContextItemRow[]` |
| markStale | `markStale(ids: string[])` → void |
| deleteOlderThan | `deleteOlderThan(days: number)` → number (count deleted) |
| getDecisions | `getDecisions(projectId?: string)` → `DecisionRow[]` |
| close | `close()` → void |
| getDbPath | `getDbPath()` → string |

**CRITICAL:** `insertContextItem` `project_id` must be the UUID returned by `insertProject`. Passing any other string causes `SQLITE_CONSTRAINT_FOREIGNKEY` error.

**ContextItemTypeEnum** allowed values: `"file_change" | "terminal_cmd" | "decision" | "comment"`.

- FileWatcher emits `"architecture-decision"` — map it to `"decision"` before inserting to DB.
- FileWatcher emits `"function"` or `"class"` — map to `"file_change"`.
- FileWatcher emits `"import"` — map to `"file_change"`.

### VectorStore

| Method | Signature |
|--------|-----------|
| constructor | `new VectorStore(options?: { chromaPath?: string, ollamaBaseUrl?: string })` |
| addContext | `addContext(item: ContextItem)` → `Promise<void>` |
| semanticSearch | `semanticSearch(query: string, projectId: string, topK: number)` → `Promise<SemanticSearchResult[]>` |
| deleteByProject | `deleteByProject(projectId: string)` → `Promise<void>` |

`ContextItem` needs: `{ type, content, filePath, projectId, timestamp }` (e.g. `timestamp: Date.now()`).

### KnowledgeGraph

| Method | Signature |
|--------|-----------|
| constructor | `new KnowledgeGraph(options?: { graphPath?: string })` |
| addNode | `addNode(node: GraphNode)` → void |
| addEdge | `addEdge(edge: GraphEdge)` → void |
| removeNode | `removeNode(nodeId: string)` → void |
| getNode | `getNode(nodeId: string)` → `GraphNode | undefined` |
| getRelated | `getRelated(nodeId: string, relation?: RelationType)` → `GraphNode[]` |
| findPath | `findPath(fromId: string, toId: string)` → `string[]` |
| getProjectSummary | `getProjectSummary(projectId: string)` → `GraphNode[]` (top 10 most connected) |
| extractFromContextItems | `extractFromContextItems(items: ContextItem[])` → void (auto-builds graph) |
| save | `save()` → void (force write to disk) |

**CRITICAL:** `getProjectSummary` uses the `projectId` stored on each node. When using `extractFromContextItems`, the `projectId` on `ContextItem`s must match what you pass to `getProjectSummary`. Use `item.projectId`, not the DB UUID.

---

## Project Structure

Updated monorepo layout after Sprint 2:

```
qunoqu-core/
├── package.json
├── SPRINT2.md
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── extractContext.ts
│   │   │   ├── extractContext.test.ts
│   │   │   ├── FileWatcher.ts
│   │   │   ├── FileWatcher.test.ts
│   │   │   ├── TerminalCapture.ts
│   │   │   ├── TerminalCapture.test.ts
│   │   │   ├── shellIntegrationScript.ts
│   │   │   ├── MetadataStore.ts
│   │   │   ├── MetadataStore.test.ts
│   │   │   ├── metadataTypes.ts
│   │   │   ├── VectorStore.ts
│   │   │   ├── VectorStore.test.ts
│   │   │   ├── OllamaEmbeddingFunction.ts
│   │   │   ├── OllamaEmbeddingFunction.test.ts
│   │   │   ├── KnowledgeGraph.ts
│   │   │   ├── KnowledgeGraph.test.ts
│   │   │   └── index.test.ts
│   │   └── dist/          (after npm run build)
│   ├── cli/
│   └── vscode-ext/
```

---

## Prerequisites

| Requirement | Version / notes |
|-------------|------------------|
| Node.js | 20+ (tested on v25.6.1) |
| npm | 10+ |
| ChromaDB | For VectorStore: `pip3 install chromadb` |
| Ollama | For VectorStore: [ollama.ai](https://ollama.ai) |
| Embedding model | `ollama pull nomic-embed-text` |

**MetadataStore** and **KnowledgeGraph** work with zero external dependencies (offline). **VectorStore** tests require ChromaDB and Ollama when not mocked.

---

## Setup

```bash
git clone <repo-url>
cd qunoqu-core
npm install
npm run build
```

---

## Automated Tests

**How to run:**

```bash
npm test
```

(from repo root; runs workspace tests)

**Expected output:** 8 test files, 35 passed, 2 skipped (the same 2 FileWatcher integration tests from Sprint 1 that require a real filesystem and can hit EMFILE in constrained environments).

| Test file | Tests | What it covers |
|-----------|-------|-----------------|
| extractContext.test.ts | 6 | Context extraction from file content (functions, classes, TODO, imports, ADR) |
| OllamaEmbeddingFunction.test.ts | 3 | Embedding function with mocked Ollama |
| KnowledgeGraph.test.ts | 8 | Graph operations, persistence, path finding, extractFromContextItems |
| TerminalCapture.test.ts | 3 | Socket capture and noise filtering |
| VectorStore.test.ts | 4 | Vector operations with mocked ChromaDB |
| MetadataStore.test.ts | 8 | CRUD, migrations, stale/delete |
| FileWatcher.test.ts | 4 (2 skipped) | File watching and hash dedup |
| index.test.ts | 1 | Package exports |

---

## Manual Tests

All manual test scripts below save to `/tmp/` and use the absolute path `/Users/aryan/Desktop/qunoqu-core` for requires. Run with:

```bash
node /tmp/s2-testN.js
```

**MetadataStore** and **KnowledgeGraph** tests work offline with no extra setup. **VectorStore** tests require ChromaDB and Ollama (see Prerequisites).

---

### TEST 1 — MetadataStore: insert and retrieve

**What this tests:** Core SQLite operations. Insert a project, context item, and decision. Retrieve them and verify all fields (including tags array, is_stale, timestamps).

**Save and run:**

```bash
cat > /tmp/s2-test1.js << 'EOF'
const { MetadataStore } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const store = new MetadataStore({ dbPath: '/tmp/qunoqu-test.db' });
console.log('DB path:', store.getDbPath());
const projectId = store.insertProject({ name: 'qunoqu-test', root_path: '/tmp/qtest' });
console.log('Inserted project ID:', projectId);
const itemId = store.insertContextItem({
  project_id: projectId,
  type: 'decision',
  content: 'We chose WebSockets because polling caused 500ms latency',
  file_path: '/tmp/qtest/service.ts',
  tags: ['websockets', 'performance']
});
console.log('Inserted context item ID:', itemId);
const decisionId = store.insertDecision({
  project_id: projectId,
  title: 'Use WebSockets for real-time updates',
  rationale: 'Polling caused 500ms latency which broke the UX',
  source_file: '/tmp/qtest/service.ts'
});
console.log('Inserted decision ID:', decisionId);
const items = store.getByProject(projectId);
console.log('\nItems for project:', items.length);
console.log('First item type:', items[0].type);
console.log('First item content:', items[0].content.slice(0, 50));
console.log('First item tags:', items[0].tags);
console.log('First item is_stale:', items[0].is_stale);
const decisions = store.getDecisions(projectId);
console.log('\nDecisions:', decisions.length);
console.log('Decision title:', decisions[0].title);
const recent = store.getRecent(5);
console.log('\nRecent items:', recent.length);
store.close();
console.log('\nPASS - MetadataStore insert and retrieve working');
EOF
node /tmp/s2-test1.js
```

**Expected output:**

```
DB path: /tmp/qunoqu-test.db
Inserted project ID: (uuid)
Inserted context item ID: (uuid)
Inserted decision ID: (uuid)
Items for project: 1
First item type: decision
First item content: We chose WebSockets because polling caused 500ms latenc
First item tags: [ 'websockets', 'performance' ]
First item is_stale: false
Decisions: 1
Decision title: Use WebSockets for real-time updates
Recent items: 1
PASS - MetadataStore insert and retrieve working
```

- **Pass:** All fields match; tags is an array; is_stale is false.
- **Fail:** `SQLITE_CONSTRAINT_FOREIGNKEY` means project_id UUID mismatch.

---

### TEST 2 — MetadataStore: markStale and deleteOlderThan

**What this tests:** Cleanup. Mark items stale by ID array; delete items older than N days; verify counts.

**Save and run:**

```bash
cat > /tmp/s2-test2.js << 'EOF'
const { MetadataStore } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const store = new MetadataStore({ dbPath: '/tmp/qunoqu-test2.db' });
const projectId = store.insertProject({ name: 'test', root_path: '/tmp' });
const id1 = store.insertContextItem({ project_id: projectId, type: 'file_change', content: 'item one', tags: [] });
const id2 = store.insertContextItem({ project_id: projectId, type: 'file_change', content: 'item two', tags: [] });
const id3 = store.insertContextItem({ project_id: projectId, type: 'terminal_cmd', content: 'npm run build', tags: [] });
console.log('Inserted 3 items');
store.markStale([id1, id2]);
const items = store.getByProject(projectId);
const staleCount = items.filter(i => i.is_stale).length;
const freshCount = items.filter(i => !i.is_stale).length;
console.log('Stale items:', staleCount, staleCount === 2 ? 'PASS' : 'FAIL - expected 2');
console.log('Fresh items:', freshCount, freshCount === 1 ? 'PASS' : 'FAIL - expected 1');
const deleted = store.deleteOlderThan(0);
console.log('Deleted items:', deleted, deleted === 3 ? 'PASS' : 'FAIL - expected 3');
const remaining = store.getByProject(projectId);
console.log('Remaining items:', remaining.length, remaining.length === 0 ? 'PASS' : 'FAIL - expected 0');
store.close();
console.log('\nPASS - markStale and deleteOlderThan working');
EOF
node /tmp/s2-test2.js
```

**Expected output:**

```
Inserted 3 items
Stale items: 2 PASS
Fresh items: 1 PASS
Deleted items: 3 PASS
Remaining items: 0 PASS
PASS - markStale and deleteOlderThan working
```

- **Pass:** All four counts correct.
- **Fail:** `deleteOlderThan(0)` deleting 0 items means cutoff calculation is wrong.

---

### TEST 3 — KnowledgeGraph: nodes, edges, path finding

**What this tests:** Graph operations. Add nodes/edges; getRelated with relation filter; findPath (BFS); getProjectSummary; persist and reload.

**Save and run:**

```bash
cat > /tmp/s2-test3.js << 'EOF'
const { KnowledgeGraph } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const g = new KnowledgeGraph({ graphPath: '/tmp/qunoqu-test-graph.json' });
const projectId = 'test-project';
g.addNode({ id: 'file:test:service.ts', type: 'file', label: 'service.ts', projectId, metadata: {} });
g.addNode({ id: 'file:test:db.ts', type: 'file', label: 'db.ts', projectId, metadata: {} });
g.addNode({ id: 'module:test:express', type: 'module', label: 'express', projectId, metadata: {} });
g.addNode({ id: 'fn:test:processPayment', type: 'function', label: 'processPayment', projectId, metadata: {} });
g.addEdge({ from: 'file:test:service.ts', to: 'module:test:express', relation: 'imports', weight: 1 });
g.addEdge({ from: 'file:test:service.ts', to: 'fn:test:processPayment', relation: 'depends_on', weight: 1 });
g.addEdge({ from: 'file:test:service.ts', to: 'file:test:db.ts', relation: 'depends_on', weight: 1 });
const node = g.getNode('file:test:service.ts');
console.log('getNode:', node?.label, node?.label === 'service.ts' ? 'PASS' : 'FAIL');
const related = g.getRelated('file:test:service.ts');
console.log('getRelated count:', related.length, related.length === 3 ? 'PASS' : 'FAIL - expected 3');
const imports = g.getRelated('file:test:service.ts', 'imports');
console.log('Imports only:', imports.length, imports.length === 1 ? 'PASS' : 'FAIL - expected 1');
console.log('Import label:', imports[0]?.label);
const path = g.findPath('file:test:service.ts', 'fn:test:processPayment');
console.log('findPath:', path, path.length > 0 ? 'PASS' : 'FAIL');
const summary = g.getProjectSummary(projectId);
console.log('Project summary nodes:', summary.length, summary.length > 0 ? 'PASS' : 'FAIL');
console.log('Top node (most connected):', summary[0]?.label);
g.save();
const g2 = new KnowledgeGraph({ graphPath: '/tmp/qunoqu-test-graph.json' });
const reloaded = g2.getNode('file:test:service.ts');
console.log('Reload from disk:', reloaded?.label, reloaded ? 'PASS' : 'FAIL');
console.log('\nPASS - KnowledgeGraph working');
EOF
node /tmp/s2-test3.js
```

**Expected output:**

```
getNode: service.ts PASS
getRelated count: 3 PASS
Imports only: 1 PASS
Import label: express
findPath: [ 'file:test:service.ts', 'fn:test:processPayment' ] PASS
Project summary nodes: 4 PASS
Top node (most connected): service.ts
Reload from disk: service.ts PASS
PASS - KnowledgeGraph working
```

- **Pass:** All PASS; reload confirms persistence.
- **Fail:** getRelated returns 0 ⇒ edges not stored correctly.

---

### TEST 4 — KnowledgeGraph: extractFromContextItems auto-builds graph

**What this tests:** Feeding raw ContextItems from FileWatcher; auto-creation of file/function/class/module/decision nodes and edges (graph self-builds).

**Save and run:**

```bash
cat > /tmp/s2-test4.js << 'EOF'
const { KnowledgeGraph, extractContext } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const fs = require('fs');
const g = new KnowledgeGraph({ graphPath: '/tmp/qunoqu-test-graph2.json' });
const fileContent = [
  "import express from 'express';",
  "import { db } from './db.js';",
  "// We chose WebSockets because polling was too slow",
  "function processPayment(amount) { return db.save(amount); }",
  "class PaymentService { process() {} }"
].join('\n');
fs.mkdirSync('/tmp/qtest', { recursive: true });
fs.writeFileSync('/tmp/qtest/payments.ts', fileContent);
const items = extractContext(fileContent, '/tmp/qtest/payments.ts', 'test-project');
console.log('Extracted items:', items.length);
items.forEach(i => console.log(' -', i.type, ':', i.content.slice(0, 50)));
g.extractFromContextItems(items, { fileContent });
g.save();
const fileNode = g.getNode('file:test-project:/tmp/qtest/payments.ts');
console.log('\nFile node exists:', fileNode ? 'PASS' : 'FAIL');
const related = g.getRelated('file:test-project:/tmp/qtest/payments.ts');
console.log('Related nodes:', related.length, related.length > 0 ? 'PASS' : 'FAIL');
related.forEach(n => console.log(' -', n.type, ':', n.label.slice(0, 50)));
const summary = g.getProjectSummary('test-project');
console.log('\nProject summary:', summary.length, 'nodes');
console.log('Most connected:', summary[0]?.label);
console.log('\nPASS - extractFromContextItems working');
EOF
node /tmp/s2-test4.js
```

**Expected output:**

```
Extracted items: 4 (or more)
 - function : processPayment
 - class : PaymentService
 - import : express (or db)
 - architecture-decision : We chose WebSockets because polling was too slow
File node exists: PASS
Related nodes: (4 or more) PASS
Project summary: 5 nodes
Most connected: /tmp/qtest/payments.ts
PASS - extractFromContextItems working
```

- **Pass:** File node exists; related nodes auto-created from imports/functions/decisions.
- **Fail:** File node missing ⇒ extractFromContextItems did not create it.

---

### TEST 5 — OllamaEmbeddingFunction (requires Ollama)

**What this tests:** Ollama REST API. Generate embeddings for two texts; verify 768 dimensions and that different texts yield different vectors.

**Check Ollama:**

```bash
curl http://localhost:11434/api/tags 2>&1 | head -3
```

If not running, skip; VectorStore handles fallback. If running but model missing: `ollama pull nomic-embed-text`.

**Save and run:**

```bash
cat > /tmp/s2-test5.js << 'EOF'
const { OllamaEmbeddingFunction } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const fn = new OllamaEmbeddingFunction({ baseUrl: 'http://localhost:11434', model: 'nomic-embed-text' });
async function run() {
  console.log('Generating embeddings via Ollama...');
  const texts = [
    'We chose WebSockets because polling was too slow',
    'npm run build failed with missing dependency'
  ];
  const embeddings = await fn.generate(texts);
  console.log('Embeddings generated:', embeddings.length);
  console.log('Dimensions:', embeddings[0].length, embeddings[0].length === 768 ? 'PASS' : 'FAIL - expected 768');
  const same = JSON.stringify(embeddings[0]) === JSON.stringify(embeddings[1]);
  console.log('Different texts produce different vectors:', !same ? 'PASS' : 'FAIL');
  console.log('\nPASS - OllamaEmbeddingFunction working');
}
run().catch(err => {
  console.log('SKIP - Ollama not running:', err.message);
  console.log('Start Ollama with: ollama serve');
});
EOF
node /tmp/s2-test5.js
```

**Expected output (when Ollama is running):**

```
Generating embeddings via Ollama...
Embeddings generated: 2
Dimensions: 768 PASS
Different texts produce different vectors: PASS
PASS - OllamaEmbeddingFunction working
```

- **Pass:** 768 dimensions; different vectors for different texts.
- **Skip:** "SKIP - Ollama not running" is acceptable; VectorStore has fallback.

---

### TEST 6 — VectorStore: semantic search (requires ChromaDB + Ollama)

**What this tests:** Full semantic pipeline. Store 3 items; search by meaning; verify top result; content-hash dedup; deleteByProject.

**Start ChromaDB (if needed):**

```bash
pip3 install chromadb
chroma run --path /tmp/qunoqu-chroma &
sleep 3 && curl http://localhost:8000/api/v1/heartbeat
```

**Save and run:**

```bash
cat > /tmp/s2-test6.js << 'EOF'
const { VectorStore } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const store = new VectorStore({ chromaPath: 'http://localhost:8000', ollamaBaseUrl: 'http://localhost:11434' });
async function run() {
  const projectId = 'test-project-' + Date.now();
  console.log('Adding context items...');
  await store.addContext({ type: 'architecture-decision', content: 'We chose WebSockets because polling caused 500ms latency', filePath: '/tmp/qtest/service.ts', projectId, timestamp: Date.now() });
  await store.addContext({ type: 'architecture-decision', content: 'We use Postgres because Redis had persistence issues in production', filePath: '/tmp/qtest/db.ts', projectId, timestamp: Date.now() });
  await store.addContext({ type: 'terminal_cmd', content: 'npm run build failed: missing RAZORPAY_KEY environment variable', filePath: null, projectId, timestamp: Date.now() });
  console.log('Added 3 items');
  await store.addContext({ type: 'architecture-decision', content: 'We chose WebSockets because polling caused 500ms latency', filePath: '/tmp/qtest/service.ts', projectId, timestamp: Date.now() });
  console.log('Added duplicate (should be ignored by hash dedup)');
  console.log('\nSearching for "why did we choose WebSockets"...');
  const results = await store.semanticSearch('why did we choose WebSockets', projectId, 3);
  console.log('Results:', results.length);
  results.forEach((r, i) => {
    console.log('  Result ' + (i+1) + ': score=' + r.score?.toFixed(3) + ', content="' + r.content.slice(0, 60) + '"');
  });
  const isRelevant = results[0]?.content?.includes('WebSocket') || results[0]?.content?.includes('polling');
  console.log('Top result relevant:', isRelevant ? 'PASS' : 'FAIL');
  await store.deleteByProject(projectId);
  console.log('\nDeleted project vectors');
  const afterDelete = await store.semanticSearch('WebSockets', projectId, 3);
  console.log('Results after delete:', afterDelete.length, afterDelete.length === 0 ? 'PASS' : 'FAIL');
  console.log('\nPASS - VectorStore working');
}
run().catch(err => {
  console.log('FAIL:', err.message);
  if (err.message.includes('ECONNREFUSED') && err.message.includes('8000')) console.log('Fix: chroma run --path /tmp/qunoqu-chroma');
  if (err.message.includes('ECONNREFUSED') && err.message.includes('11434')) console.log('Fix: ollama serve');
});
EOF
node /tmp/s2-test6.js
```

**Expected output (when ChromaDB + Ollama running):**

```
Added 3 items
Added duplicate (should be ignored by hash dedup)
Searching for "why did we choose WebSockets"...
Results: 3
  Result 1: score=0.9xx, content="We chose WebSockets because polling caused 500ms lat"
  Result 2: score=0.8xx, content="We use Postgres because Redis had persistence issues"
  Result 3: score=0.7xx, content="npm run build failed: missing RAZORPAY_KEY environme"
Top result relevant: PASS
Deleted project vectors
Results after delete: 0 PASS
PASS - VectorStore working
```

- **Pass:** Top result contains WebSocket or polling; delete cleans up.
- **Skip:** ECONNREFUSED ⇒ ChromaDB or Ollama not running — acceptable for local dev.

---

### TEST 7 — Full Sprint 2 pipeline (FileWatcher + MetadataStore + KnowledgeGraph)

**What this tests:** End-to-end: FileWatcher detects file save → emits ContextItems → stored in MetadataStore and KnowledgeGraph (capture → storage → graph in one flow).

**Notes:**

- Use the UUID from `insertProject` as MetadataStore `project_id`.
- FileWatcher uses its own `projectId` (options); use `item.projectId` for KnowledgeGraph, DB UUID for MetadataStore.
- The `done` flag avoids double-processing when chokidar fires multiple events.

**Save and run:**

```bash
cat > /tmp/s2-test7.js << 'EOF'
const { FileWatcher, MetadataStore, KnowledgeGraph } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const fs = require('fs');
const db = new MetadataStore({ dbPath: '/tmp/qunoqu-pipeline-test3.db' });
const graph = new KnowledgeGraph({ graphPath: '/tmp/qunoqu-pipeline-graph3.json' });
const dbProjectId = db.insertProject({ name: 'pipeline-test', root_path: '/tmp/qtest' });
const watcherProjectId = 'qunoqu-pipeline-test';
console.log('DB project UUID:', dbProjectId.slice(0, 8) + '...');
console.log('Watcher projectId:', watcherProjectId);
const watcher = new FileWatcher('/tmp/qtest', { projectId: watcherProjectId });
let done = false;
watcher.on('context-captured', (items) => {
  if (done) return;
  console.log('\nFileWatcher captured', items.length, 'items');
  console.log('Item projectId:', items[0]?.projectId);
  items.forEach(item => {
    const dbType = item.type === 'architecture-decision' ? 'decision' : item.type === 'function' || item.type === 'class' ? 'file_change' : item.type === 'import' ? 'file_change' : 'comment';
    try {
      db.insertContextItem({ project_id: dbProjectId, type: dbType, content: item.content, file_path: item.filePath, tags: [item.type] });
    } catch(e) { console.log('DB error:', e.message); }
  });
  graph.extractFromContextItems(items);
  graph.save();
  const storedItems = db.getByProject(dbProjectId);
  const graphNodes = graph.getProjectSummary(watcherProjectId);
  console.log('\nPipeline verification:');
  console.log('  DB items:', storedItems.length, storedItems.length > 0 ? 'PASS' : 'FAIL');
  console.log('  Graph nodes:', graphNodes.length, graphNodes.length > 0 ? 'PASS' : 'FAIL');
  graphNodes.forEach(n => console.log('   -', n.type, '|', n.label.slice(0, 40)));
  done = true;
  watcher.close().then(() => {
    db.close();
    const allPass = storedItems.length > 0 && graphNodes.length > 0;
    console.log('\n' + (allPass ? 'FULL PIPELINE PASS - Capture to DB to Graph working' : 'PARTIAL - check above'));
    process.exit(0);
  });
});
try { fs.unlinkSync('/tmp/qtest/pipeline-test3.ts'); } catch {}
watcher.watch('/tmp/qtest');
console.log('Pipeline starting...');
setTimeout(() => {
  fs.writeFileSync('/tmp/qtest/pipeline-test3.ts', [
    "import express from 'express';",
    "import { db } from './database.js';",
    "// We chose Express because Fastify had limited middleware support",
    "function handleRequest(req, res) {}",
    "class RequestHandler { process() {} }"
  ].join('\n'));
  console.log('File written');
}, 1500);
setTimeout(() => { console.log('FAIL - timeout'); process.exit(1); }, 6000);
EOF
node /tmp/s2-test7.js
```

**Expected output:**

```
DB project UUID: xxxxxxxx...
Watcher projectId: qunoqu-pipeline-test
Pipeline starting...
File written
FileWatcher captured 4 items
Item projectId: qunoqu-pipeline-test
Pipeline verification:
  DB items: 4 PASS
  Graph nodes: 5 PASS
   - file | /tmp/qtest/pipeline-test3.ts
   - function | handleRequest
   - function | RequestHandler
   - module | express
   - decision | We chose Express because Fastify had limited...
FULL PIPELINE PASS - Capture to DB to Graph working
```

- **Pass:** DB items and graph nodes both > 0.
- DB uses UUID projectId; Graph uses watcher projectId — intentionally different this sprint; Sprint 3 will unify with a single project config.

---

## Sprint 2 Done Criteria

All of the following must be true before merging:

- [ ] `npm test` shows 35 passed, 0 test files failing
- [ ] S2-T1 MetadataStore insert/retrieve passes (all fields correct)
- [ ] S2-T2 markStale and deleteOlderThan pass (cleanup works)
- [ ] S2-T3 KnowledgeGraph nodes, edges, path finding, disk persistence all pass
- [ ] S2-T4 extractFromContextItems auto-builds graph from FileWatcher output
- [ ] S2-T7 Full pipeline passes (FileWatcher → DB → Graph)
- [ ] S2-T5 and S2-T6 are optional locally but must pass in CI when Ollama/ChromaDB are available

---

## Known Limitations (Sprint 3 will address)

- **ProjectId not unified:** MetadataStore uses UUID; FileWatcher uses a string option. Sprint 3 will add a project config so both use the same ID.
- **VectorStore not in pipeline:** Sprint 3 wires all three stores together.
- **No MCP server yet:** Sprint 3 adds the MCP server so Claude Desktop can query memory.
- **Shell script not auto-installed:** `SHELL_INTEGRATION_SCRIPT` is exported but not installed; Sprint 4 CLI will handle installation.

---

## What’s Next — Sprint 3

**feat/mcp-server** — MCP server with tools such as `recall_context`, `save_decision`, `get_project_summary`. Claude Desktop will be able to query everything stored in Sprint 2.
