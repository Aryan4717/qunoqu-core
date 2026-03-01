# Sprint 6 — Daemon (Automatic Capture)

> **Sprint 6** = one-time `qunoqu init` + `qunoqu daemon start` and capture runs automatically forever. No manual seeding, no manual server start, no manual anything.

Before Sprint 6, you had to start the REST server and rely on Cursor/VS Code or manual scripts to capture context. After Sprint 6, the **Qunoq daemon** runs in the background: it watches your project, captures file changes and terminal commands, runs everything through the privacy filter, stores to SQLite + ChromaDB + KnowledgeGraph, and serves the REST API. You run two commands and it keeps going until you stop it.

---

## What Was Built

### 1. QunoqDaemon (`packages/core/src/QunoqDaemon.ts`)

A class that orchestrates everything in the background.

| Option       | Default                 | Description                          |
|-------------|-------------------------|--------------------------------------|
| `projectRoot` | (required)            | Project directory to watch           |
| `projectId`   | (required)            | Project identifier                   |
| `dbPath`      | `~/.qunoqu/memory.db` | SQLite database path                 |
| `restPort`    | `7384`                | REST API port                        |
| `logPath`     | `~/.qunoqu/daemon.log`| Daemon log file                      |
| `pidPath`     | `~/.qunoqu/daemon.pid`| PID file for CLI start/stop          |

**`start()`** in order: init MetadataStore → KnowledgeGraph → VectorStore (warn and continue if fail) → `syncChromaFromSQLite()` → FileWatcher (context-captured → PrivacyFilter → store) → TerminalCapture (terminal-event → PrivacyFilter → store) → REST server → write PID → log.

**`storeItem(item, metaType)`:** Filter → SQLite → ChromaDB (if available) → KnowledgeGraph for decisions → log.

**`stop()`:** Close FileWatcher, stop TerminalCapture, close REST server, close MetadataStore, delete PID file, log "Daemon stopped".

**`getStatus()`** returns: `running`, `pid`, `projectId`, `projectRoot`, `capturedToday`, `totalCaptured`, `restServerRunning`, `startedAt`.

---

### 2. run-daemon.ts (`packages/core/src/run-daemon.ts`)

Entrypoint spawned by the CLI as a **detached** child process.

- Reads `projectRoot` from `QUNOQU_PROJECT_ROOT` env or `process.cwd()`
- Reads `projectId` from `QUNOQU_PROJECT_ID` env, then `.qunoqu-config.json` in project root, then `detectProjectId(projectRoot)`
- Exits with code 1 if `projectId` not found
- Creates `QunoqDaemon`, calls `start()`, handles SIGINT/SIGTERM (stop + exit 0) and uncaughtException (log + stop + exit 1)

---

### 3. CLI daemon commands (`packages/cli/src/cli.ts`)

All daemon subcommands live under `qunoqu daemon`.

| Command              | Description                          |
|----------------------|--------------------------------------|
| `qunoqu daemon start`   | Start background daemon (detached)   |
| `qunoqu daemon stop`    | Stop daemon (SIGTERM, then SIGKILL)  |
| `qunoqu daemon status`  | Show PID, project, counts, REST, logs|
| `qunoqu daemon logs`    | Last 30 lines of daemon log          |
| `qunoqu daemon restart` | Stop then start                      |

Helpers: `getDaemonPid()` (reads `~/.qunoqu/daemon.pid`, verifies process with `process.kill(pid, 0)`), `resolveRunDaemonPath(cwd)` (same pattern as run-mcp for `run-daemon.js`).

**`qunoqu init`** now prints at the end: *"Run 'qunoqu daemon start' to begin capturing automatically."*

---

## Daemon commands — npx / node

All commands assume you are in the project root (or a directory where `npx qunoqu` resolves to this CLI). Run `npm run build` first if you changed source.

### Start daemon

```bash
npx qunoqu daemon start
```

Or with full path to CLI:

```bash
node /path/to/qunoqu-core/packages/cli/dist/cli.js daemon start
```

**Expected output:**
```
Qunoqu daemon started (PID: 12345)
  Watching: /path/to/your-project
  REST server: http://localhost:7384
  Logs: ~/.qunoqu/daemon.log
```

The CLI exits immediately; the daemon runs in the background.

---

### Stop daemon

```bash
npx qunoqu daemon stop
```

Or:

```bash
node packages/cli/dist/cli.js daemon stop
```

**Expected output:** `Daemon stopped`

---

### Daemon status

```bash
npx qunoqu daemon status
```

Or:

```bash
node packages/cli/dist/cli.js daemon status
```

**Expected output (when running):**
```
Daemon running (PID: 12345)
  Project: qunoqu-core
  Watching: /path/to/project
  REST server: running
  Total captured: 42 items
  Captured today: 3 items
  Started: running
  Logs: ~/.qunoqu/daemon.log
```

**When not running:** `Daemon is not running` and `Run: qunoqu daemon start`.

---

### Daemon logs (last 30 lines)

```bash
npx qunoqu daemon logs
```

Or:

```bash
node packages/cli/dist/cli.js daemon logs
```

Timestamps in gray, "Stored:" in green, "Filtered:" in yellow, "ERROR" in red. If the log file does not exist: `No logs yet. Start daemon first.`

---

### Restart daemon

```bash
npx qunoqu daemon restart
```

Or:

```bash
node packages/cli/dist/cli.js daemon restart
```

Runs stop logic then start logic in sequence.

---

### Full flow: init then daemon

```bash
cd /path/to/your-project

# One-time setup
npx qunoqu init

# Start automatic capture (detached)
npx qunoqu daemon start

# Later: check status
npx qunoqu daemon status

# View recent activity
npx qunoqu daemon logs

# Stop when done
npx qunoqu daemon stop
```

---

## Project structure (Sprint 6 additions)

```
qunoqu-core/
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── QunoqDaemon.ts      # Sprint 6 — daemon orchestrator
│   │       ├── QunoqDaemon.test.ts # Sprint 6 — tests
│   │       ├── run-daemon.ts       # Sprint 6 — daemon entrypoint
│   │       ├── ...
│   │       └── index.ts            # exports QunoqDaemon, DaemonOptions, DaemonStatus
│   └── cli/
│       └── src/
│           └── cli.ts              # daemon start/stop/status/logs/restart
├── .qunoqu-config.json
└── package.json
```

---

## Full system architecture (with daemon)

```
Developer runs: qunoqu init → qunoqu daemon start
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Sprint 6 — QunoqDaemon (background process)                     │
│  • FileWatcher (project root) → PrivacyFilter → store            │
│  • TerminalCapture (/tmp/qunoqu.sock) → PrivacyFilter → store   │
│  • syncChromaFromSQLite on start                                  │
│  • REST server (port 7384)                                        │
│  • PID at ~/.qunoqu/daemon.pid, logs at ~/.qunoqu/daemon.log     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        MetadataStore (SQLite) + VectorStore (Chroma) + KnowledgeGraph
                              ↓
        MCP (Cursor, etc.) + REST API (ChatGPT, DeepSeek, etc.)
```

---

## Prerequisites

- Node.js 18+
- `qunoqu init` already run in the project (so `.qunoqu-config.json` and projectId exist)
- Optional: Ollama + ChromaDB for semantic search (daemon continues without them)

---

## Automated tests

From repo root:

```bash
npm test
```

**QunoqDaemon.test.ts** (10 tests): daemon starts without crashing; stores file change via `storeItem()`; drops `.env` via PrivacyFilter; redacts API key; stores terminal command; `stop()` cleans up; `getStatus()` correct; `syncChromaFromSQLite()` on start; `storeItem()` skips ChromaDB gracefully on failure; SIGTERM handled via `stop()`. FileWatcher, TerminalCapture, VectorStore, and `startServer` are mocked; MetadataStore uses a temp DB.

---

## Manual tests (daemon)

From project root (e.g. `~/Desktop/qunoqu-core`), after `npm run build`:

| Step | Command | What to check |
|------|--------|----------------|
| 1 | `npx qunoqu daemon start` | Prints PID, watching path, REST URL, log path; CLI exits |
| 2 | `npx qunoqu daemon status` | Shows "Daemon running", PID, total/today counts |
| 3 | `npx qunoqu daemon logs` | Last 30 lines with colored Stored/Filtered/ERROR |
| 4 | `npx qunoqu daemon stop` | Prints "Daemon stopped" |
| 5 | `npx qunoqu daemon status` | Shows "Daemon is not running" and "Run: qunoqu daemon start" |
| 6 | `npx qunoqu daemon start` then `npx qunoqu daemon restart` | Restart runs stop then start |

If daemon is already running, `npx qunoqu daemon start` prints: `Daemon already running (PID: …)`.

---

## Sprint 6 done criteria

- [ ] `npm run build` succeeds for all workspaces
- [ ] `npm test` passes (all packages; may need full permissions for socket/file watcher tests)
- [ ] `npx qunoqu daemon start` starts detached process and prints PID + paths
- [ ] `npx qunoqu daemon status` shows running state and real capture counts when daemon is up
- [ ] `npx qunoqu daemon stop` stops the daemon and removes PID file
- [ ] `npx qunoqu daemon logs` shows last 30 lines with formatting
- [ ] `npx qunoqu daemon restart` runs stop then start
- [ ] `qunoqu init` ends with the line: *"Run 'qunoqu daemon start' to begin capturing automatically."*
