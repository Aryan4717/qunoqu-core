# Sprint 4 — CLI Tool

> **Sprint 1** = capture context. **Sprint 2** = store it. **Sprint 3** = query via AI tools. **Sprint 4** = control everything from your terminal.

Before Sprint 4, using Qunoqu required writing JavaScript scripts manually, editing JSON config files by hand, and finding file paths yourself. After Sprint 4, a new teammate runs three commands and is fully set up in 30 seconds. Sprint 4 is what makes Qunoqu a real tool instead of a collection of scripts.

---

## What Was Built

One file: `packages/cli/src/cli.ts` — a full CLI using `commander`, `chalk`, `ora`, and `boxen`, importing `detectProjectId`, `SHELL_INTEGRATION_SCRIPT`, and `MetadataStore` from `@qunoqu/core`.

### `qunoqu init`
One-time project setup. Detects your project ID from git remote via `detectProjectId()`, creates `~/.qunoqu/shell-integration.sh`, and writes `.qunoqu-config.json` in your project root. Displays a boxen with next steps. **Replaces all manual setup from Sprints 1–3.**

### `qunoqu status`
Shows the current state of your memory layer. Reads `~/.qunoqu/memory.db` and displays total memories, memories captured today, last capture timestamp, Ollama status, ChromaDB status, and whether Cursor MCP is configured. **Answers "is Qunoqu working right now?" without any manual debugging.**

### `qunoqu recall [query]`
Keyword search of project memory from the terminal. Pass a query to search, or omit it to show the 15 most recent items. Displays results with type icons (📄 file, ⌨ terminal, ✓ decision, 💬 comment), timestamps, file paths, and content previews. **Developers can search memory without opening Cursor.**

### `qunoqu doctor`
Diagnoses the full setup. Checks Ollama, ChromaDB, shell integration script, and Cursor MCP config. Shows ✓ for passing checks and ✗ with exact fix instructions for failing ones. **Replaces all manual debugging across Sprints 1–3.**

### `qunoqu config cursor`
Auto-writes `.cursor/mcp.json` in the current directory with the correct absolute path to `run-mcp.js` and the auto-detected project ID. **Replaces manual JSON editing to connect Cursor MCP.**

---

## Full System Architecture

```
Developer writes code / runs terminal commands
              ↓
┌─────────────────────────────────────────┐
│  Sprint 1 — Capture                     │
│  FileWatcher + TerminalCapture          │
│  Watches files, listens on Unix socket  │
└──────────────────┬──────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│  Sprint 2 — Store                       │
│  MetadataStore (SQLite)                 │
│  VectorStore (ChromaDB + Ollama)        │
│  KnowledgeGraph (JSON)                  │
└──────────────────┬──────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│  Sprint 3 — Query via AI                │
│  QunoqMCPServer (stdio MCP protocol)    │
│  Tools: recall_context, save_decision,  │
│  get_project_summary, list_projects     │
│  ProjectDetector (stable UUID from git) │
└──────────────────┬──────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│  Sprint 4 — Developer Control Layer     │
│  CLI: qunoqu init / status / recall /   │
│       doctor / config cursor            │
└─────────────────────────────────────────┘
```

---

## Project Structure

```
qunoqu-core/
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── FileWatcher.ts          # Sprint 1
│   │       ├── TerminalCapture.ts      # Sprint 1
│   │       ├── extractContext.ts       # Sprint 1
│   │       ├── shellIntegrationScript.ts # Sprint 1
│   │       ├── MetadataStore.ts        # Sprint 2
│   │       ├── VectorStore.ts          # Sprint 2
│   │       ├── KnowledgeGraph.ts       # Sprint 2
│   │       ├── OllamaEmbeddingFunction.ts # Sprint 2
│   │       ├── QunoqMCPServer.ts       # Sprint 3
│   │       ├── ProjectDetector.ts      # Sprint 3
│   │       ├── run-mcp.ts              # Sprint 3
│   │       ├── types.ts
│   │       ├── metadataTypes.ts
│   │       └── index.ts
│   ├── cli/
│   │   └── src/
│   │       └── cli.ts                  # Sprint 4 — this sprint
│   └── vscode-ext/
│       └── src/
│           └── extension.ts            # scaffolded, Sprint 5
├── .qunoqu-config.json                 # created by qunoqu init
└── package.json
```

---

## Prerequisites

- Node.js 20+ (tested on v25.6.1)
- npm 10+
- Cursor IDE (for MCP integration)
- Ollama — optional, for semantic search (falls back to keyword without it)
- ChromaDB — optional, for semantic search (falls back to keyword without it)

---

## Quick Start for New Teammates

This is the complete setup sequence. Run these commands in order.

**Step 1 — Clone and build:**
```bash
git clone <repo-url>
cd qunoqu-core
npm install
npm run build
```

**Step 2 — Initialize your project:**
```bash
cd <your-project-directory>
node /path/to/qunoqu-core/packages/cli/dist/cli.js init
```

**Step 3 — Add shell integration:**
```bash
echo 'source ~/.qunoqu/shell-integration.sh' >> ~/.zshrc
source ~/.zshrc
```

**Step 4 — Configure Cursor MCP:**
```bash
node /path/to/qunoqu-core/packages/cli/dist/cli.js config cursor
# Restart Cursor after this
```

**Step 5 — Verify everything works:**
```bash
node /path/to/qunoqu-core/packages/cli/dist/cli.js doctor
```

You should see ✓ for shell integration and MCP config. Ollama and ChromaDB show ✗ unless you have them installed locally — that is fine for keyword-only memory.

---

## Automated Tests

Run from the project root:

```bash
npm test
```

Expected output:
```
Test Files  8 passed (8)  ← core package
     Tests  38 passed (38)

Test Files  1 passed (1)  ← cli package
     Tests  1 passed (1)

Test Files  1 passed (1)  ← vscode-ext package
     Tests  1 passed (1)
```

**40 total tests, 0 failed, 0 skipped.**

| Test File | Tests | What it covers |
|-----------|-------|---------------|
| extractContext.test.ts | 6 | Context extraction from file content |
| OllamaEmbeddingFunction.test.ts | 3 | Embedding function with mocked Ollama |
| KnowledgeGraph.test.ts | 8 | Graph operations, persistence, path finding |
| MetadataStore.test.ts | 9 | All CRUD, migrations, keyword search, list projects |
| TerminalCapture.test.ts | 3 | Socket capture and noise filtering |
| VectorStore.test.ts | 4 | Vector operations with mocked ChromaDB |
| FileWatcher.test.ts | 4 | File watching and hash dedup — all passing |
| index.test.ts | 1 | Package exports |
| cli.test.ts | 1 | CLI package wired to core |
| extension.test.ts | 1 | VS Code extension scaffold |

---

## Manual Tests

All commands run from `~/Desktop/qunoqu-core`. The CLI binary is at `packages/cli/dist/cli.js`. Always run `npm run build` first if you changed any source files.

---

### TEST 1 — CLI help and version

**What this tests:** The CLI binary is correctly built, all 5 commands are registered, and Commander is wired up correctly.

```bash
node ~/Desktop/qunoqu-core/packages/cli/dist/cli.js --help
node ~/Desktop/qunoqu-core/packages/cli/dist/cli.js --version
```

**Expected `--help` output:**
```
Usage: qunoqu [options] [command]

Qunoqu – developer memory for AI

Options:
  -V, --version    output the version number
  -h, --help       display help for command

Commands:
  init             Set up project, shell integration, and config
  status           Show memory stats and service status
  recall [query]   Search memories (keyword). Omit query for recent items.
  doctor           Diagnose setup (Ollama, ChromaDB, shell, MCP)
  config <cursor>  Write .cursor/mcp.json for Cursor IDE
```

**Expected `--version` output:**
```
0.0.0
```

✅ Pass: all 5 commands listed, version shows
❌ Fail: command not found means `npm run build` was not run

---

### TEST 2 — qunoqu init

**What this tests:** `init` detects project ID from git remote, creates `~/.qunoqu/` directory, writes the shell integration script, and writes `.qunoqu-config.json` in the project root. The config must contain the correct projectId matching `detectProjectId()` for this repo.

```bash
cd ~/Desktop/qunoqu-core && node packages/cli/dist/cli.js init
```

**Expected output:**
```
✔ Qunoqu initialized.
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                            │
│   Next steps:                                                              │
│                                                                            │
│   1. Add to your shell config (~/.bashrc or ~/.zshrc):                     │
│      source ~/.qunoqu/shell-integration.sh                                 │
│                                                                            │
│   2. Restart your terminal or run: source ~/.qunoqu/shell-integration.sh   │
│                                                                            │
│   3. (Optional) Configure Cursor MCP:                                      │
│      npx qunoqu config cursor                                              │
│                                                                            │
│   4. Use the VS Code extension or MCP to capture and recall memories.      │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Then verify the files were created:**
```bash
cat ~/Desktop/qunoqu-core/.qunoqu-config.json
ls ~/.qunoqu/shell-integration.sh
head -5 ~/.qunoqu/shell-integration.sh
```

**Expected config file:**
```json
{
  "projectId": "5193ac5a-1d9e-8878-c6d1-b1f95c0313dd",
  "createdAt": 1772170254098,
  "version": "0.0.0"
}
```

**Expected shell script first line:**
```
# qunoqu shell integration – bash and zsh
```

✅ Pass: config file has UUID projectId, shell script exists at `~/.qunoqu/shell-integration.sh`
❌ Fail: `init failed` means mkdir or writeFile permission error

---

### TEST 3 — qunoqu doctor

**What this tests:** `doctor` checks all 4 components and shows correct ✓/✗ status. After running `init`, shell integration should show ✓. Ollama and ChromaDB show ✗ unless locally running — this is expected.

```bash
cd ~/Desktop/qunoqu-core && node packages/cli/dist/cli.js doctor
```

**Expected output:**
```
 Qunoqu doctor

  ✗ Ollama running
    → Start Ollama: ollama serve (or install from https://ollama.ai)
  ✗ ChromaDB accessible
    → Run: chroma run --path /tmp/chroma
  ✓ Shell integration script
  ✓ MCP config (Cursor)
```

✅ Pass: shell integration shows ✓ after `init`, fix instructions shown for ✗ items
❌ Fail: shell integration shows ✗ after `init` means `writeFile` failed

---

### TEST 4 — qunoqu status

**What this tests:** `status` reads real data from `~/.qunoqu/memory.db` and shows memory counts, last capture time, and service availability. Should show the memories seeded during Sprint 3 testing.

```bash
cd ~/Desktop/qunoqu-core && node packages/cli/dist/cli.js status
```

**Expected output:**
```
 Qunoqu status

  Total memories:      2
  Memories today:      2
  Last capture:        2026-02-26T...
  Ollama:              not running
  ChromaDB:            not accessible
  MCP (Cursor):        not configured
```

✅ Pass: total memories shows correct count from `~/.qunoqu/memory.db`

> **Note:** MCP shows "not configured" here because `status` checks for `.cursor/mcp.json` inside the project root. Run `qunoqu config cursor` to create it there.

---

### TEST 5 — qunoqu recall with keyword query

**What this tests:** `recall` searches `~/.qunoqu/memory.db` using `keywordSearch()` for the current project and displays results with type icons, timestamps, file paths, and content previews.

```bash
cd ~/Desktop/qunoqu-core && node packages/cli/dist/cli.js recall WebSockets
```

**Expected output:**
```
 Recall: WebSockets

  ✓ 2026-02-26T... packages/core/src/TerminalCapture.ts
    We chose WebSockets because polling caused 500ms latency
```

✅ Pass: result shows with ✓ icon (decision type), correct file path and content
❌ Fail: "No memories found" means project ID mismatch between CLI and DB

---

### TEST 6 — qunoqu recall with no query

**What this tests:** `recall` with no query shows the most recent 15 items across the project regardless of content. Falls back to `getByProject().slice(0,15)`.

```bash
cd ~/Desktop/qunoqu-core && node packages/cli/dist/cli.js recall
```

**Expected output:**
```
 Recall: (recent)

  ✓ 2026-02-26T... packages/core/src/TerminalCapture.ts
    We chose WebSockets because polling caused 500ms latency

  ✓ 2026-02-26T... packages/core/src/MetadataStore.ts
    We use SQLite because it requires zero infrastructure and works offline
```

✅ Pass: shows all items for the project, newest first
❌ Fail: "No memories found" means project ID not resolved correctly

---

### TEST 7 — qunoqu config cursor

**What this tests:** `config cursor` resolves the absolute path to `run-mcp.js` automatically, detects the project ID, and writes `.cursor/mcp.json` with the correct structure for Cursor MCP integration.

```bash
cd ~/Desktop/qunoqu-core && node packages/cli/dist/cli.js config cursor
```

**Expected output:**
```
Wrote /Users/aryan/Desktop/qunoqu-core/.cursor/mcp.json
  QUNOQU_PROJECT_ID: 5193ac5a-1d9e-8878-c6d1-b1f95c0313dd
Restart Cursor for the MCP server to load.
```

**Then verify the file:**
```bash
cat ~/Desktop/qunoqu-core/.cursor/mcp.json
```

**Expected file content:**
```json
{
  "mcpServers": {
    "qunoqu": {
      "command": "node",
      "args": ["/Users/aryan/Desktop/qunoqu-core/packages/core/dist/run-mcp.js"],
      "env": {
        "QUNOQU_PROJECT_ID": "5193ac5a-1d9e-8878-c6d1-b1f95c0313dd"
      }
    }
  }
}
```

✅ Pass: file written with correct absolute path to `run-mcp.js` and correct projectId
❌ Fail: "Could not resolve @qunoqu/core" means run from project root after `npm install`

---

### TEST 8 — Full new teammate onboarding flow

**What this tests:** The complete sequence a new teammate follows from zero to fully set up. All 5 commands work together as a complete workflow.

```bash
cd ~/Desktop/qunoqu-core

# Step 1 - initialize
node packages/cli/dist/cli.js init

# Step 2 - configure Cursor
node packages/cli/dist/cli.js config cursor

# Step 3 - check everything
node packages/cli/dist/cli.js doctor

# Step 4 - check memory
node packages/cli/dist/cli.js status

# Step 5 - search memory
node packages/cli/dist/cli.js recall SQLite
```

**Expected final state after all 5 steps:**

| Check | Expected |
|-------|----------|
| `.qunoqu-config.json` exists | ✅ with correct projectId |
| `~/.qunoqu/shell-integration.sh` exists | ✅ |
| `.cursor/mcp.json` exists | ✅ with absolute path |
| `doctor` shell integration | ✓ |
| `doctor` MCP config | ✓ |
| `status` total memories | shows real count |
| `recall SQLite` | returns the SQLite decision |

✅ Pass: all 5 steps complete without errors, doctor shows 2 green checks
This is the complete onboarding flow for any new teammate.

---

## Connecting Shell Integration

After running `qunoqu init`, add to `~/.zshrc`:

```bash
echo 'source ~/.qunoqu/shell-integration.sh' >> ~/.zshrc
source ~/.zshrc
```

After this, terminal commands are automatically sent to the Qunoqu socket and captured by `TerminalCapture` when the daemon is running.

> **Note:** Full terminal capture requires the daemon (Sprint 5) to be running. The shell script sends commands but they are only stored when something is listening on `/tmp/qunoqu.sock`.

---

## Sprint 4 Done Criteria

All must be true before merging to main:

- [ ] `npm test` shows 40 passed, 0 failed across all packages
- [ ] S4-T1: CLI help shows all 5 commands, version shows `0.0.0`
- [ ] S4-T2: `qunoqu init` creates config file and shell script correctly
- [ ] S4-T3: `qunoqu doctor` shows correct ✓/✗ for all 4 checks
- [ ] S4-T4: `qunoqu status` shows real memory count from `~/.qunoqu/memory.db`
- [ ] S4-T5: `qunoqu recall <query>` returns matching memories with type icons
- [ ] S4-T6: `qunoqu recall` with no query returns recent items
- [ ] S4-T7: `qunoqu config cursor` writes correct `mcp.json` with absolute path
- [ ] S4-T8: Full onboarding flow completes without errors

---

