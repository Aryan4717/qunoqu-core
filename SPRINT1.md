# Sprint 1 — Core Capture Engine

This sprint delivers the **core capture engine** for Qunoqu: a developer-centric AI memory layer. It provides passive, local-only capture of file changes and terminal commands so that context can be stored and later retrieved without sending data off the machine.

---

## What Was Built

| Component | Description |
|-----------|-------------|
| **FileWatcher** | Watches a project directory recursively (chokidar). On file add/change, reads content, extracts context (functions, classes, TODO/FIXME, imports, architecture-decision comments), and emits `context-captured` with a typed `ContextItem[]`. Uses a SHA-256 hash cache to avoid duplicate events and respects ignore patterns. |
| **TerminalCapture** | Listens on a Unix socket (`/tmp/qunoqu.sock` by default) for JSON payloads from shell integration. Validates payloads, filters noise commands (`cd`, `ls`, `pwd`, `echo`), and emits `terminal-event` with `TerminalEvent` (command, exitCode, cwd, output, timestamp, projectId). |
| **extractContext** | Utility that parses file content and returns a typed `ContextItem[]` (function names, class names, TODO/FIXME, import/require, and comments containing "because", "decided", "chose", "reason"). |

- **TypeScript** strict mode across the monorepo.
- **Vitest** test suite: 14 tests, 0 skipped across all packages.
- **GitHub Actions** CI pipeline (when configured).

---

## Project Structure

```
qunoqu-core/
├── package.json              # Root workspace (npm workspaces)
├── tsconfig.json             # Base TypeScript config (strict, ES2022)
├── .eslintrc.cjs
├── .prettierrc
├── packages/
│   ├── core/                 # Capture + storage engine
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts
│   │       ├── extractContext.ts
│   │       ├── FileWatcher.ts
│   │       ├── TerminalCapture.ts
│   │       ├── shellIntegrationScript.ts
│   │       └── *.test.ts
│   ├── cli/                  # CLI tool (scaffolded)
│   │   └── src/cli.ts
│   └── vscode-ext/           # VS Code extension (scaffolded)
│       └── src/extension.ts
└── SPRINT1.md
```

---

## Prerequisites

- **Node.js** 20+ (npm 10+). Node.js v25 has been tested and works.
- **npm** 10+ (for workspaces).

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

### Run all tests (from repo root)

```bash
npm test
```

**Expected output:** All 4 test files passing with **14 tests, 0 skipped**.

Example:

```
✓ packages/core  (e.g. 4 test files, 14 tests)
✓ packages/cli   (1 test file)
✓ packages/vscode-ext (1 test file)
```

### Watch mode (core only)

```bash
cd packages/core && npx vitest --watch
```

### Verbose (see every test name)

```bash
cd packages/core && npx vitest run --reporter=verbose
```

---

## Manual Tests

All manual test scripts should be saved under `~/Desktop/` and must require the built package using the **absolute path** `/Users/aryan/Desktop/qunoqu-core`. Run them with:

```bash
node ~/Desktop/testN.js
```

Use **Cmd+T** to open new Terminal tabs when a second terminal is needed.

---

### TEST 1 — FileWatcher captures a decision comment

**What this tests:** FileWatcher detects architecture-decision patterns in code (comments containing "because", "decided", "chose") and emits `context-captured` with the correct type, content, filePath, and projectId.

**Terminal 1 — save and run:**

```bash
cat > ~/Desktop/test1.js << 'EOF'
const { FileWatcher } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const w = new FileWatcher('/tmp/qtest', { projectId: 'test' });
w.on('context-captured', (items) => {
  items.forEach(item => {
    console.log('CAPTURED:', item.type, '-', item.content.slice(0, 60));
  });
});
w.watch();
console.log('Watching /tmp/qtest...');
EOF
mkdir -p /tmp/qtest
node ~/Desktop/test1.js
```

**Terminal 2 (Cmd+T):**

```bash
echo "// We chose WebSockets because polling caused 500ms latency" > /tmp/qtest/service.ts
```

**Expected output in Terminal 1:**

```
Watching /tmp/qtest...
CAPTURED: architecture-decision - // We chose WebSockets because polling caused 500
```

| | |
|---|---|
| **Pass** | Event fires within 2 seconds, type is `architecture-decision`, content contains the comment |
| **Fail** | Nothing printed, or event takes more than 2 seconds |

---

### TEST 2 — FileWatcher ignores node_modules and .env (privacy gate)

**What this tests:** Changes inside `node_modules/` and `.env` files must **never** be captured. This is a critical privacy test — `.env` contains API keys and secrets. Zero events must fire for any ignored path.

**Terminal 1 — Ctrl+C to stop test1, then save and run:**

```bash
cat > ~/Desktop/test2.js << 'EOF'
const { FileWatcher } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const fs = require('fs');
const w = new FileWatcher('/tmp/qtest', { projectId: 'test' });
let count = 0;
w.on('context-captured', () => {
  count++;
  console.log('FAIL - event leaked, count:', count);
});
w.watch();
console.log('Testing ignore patterns - silence means passing...');
setTimeout(() => {
  fs.mkdirSync('/tmp/qtest/node_modules/pkg', { recursive: true });
  fs.writeFileSync('/tmp/qtest/node_modules/pkg/index.js', 'secret=abc123');
  fs.writeFileSync('/tmp/qtest/.env', 'API_KEY=supersecret');
  console.log('Wrote to node_modules and .env');
}, 500);
setTimeout(() => {
  console.log('Total leaked events:', count);
  console.log(count === 0 ? 'PASS - ignore patterns working' : 'FAIL - ' + count + ' events leaked');
  w.close();
}, 3000);
EOF
node ~/Desktop/test2.js
```

**Terminal 2:** Nothing needed.

**Expected output:**

```
Testing ignore patterns - silence means passing...
Wrote to node_modules and .env
Total leaked events: 0
PASS - ignore patterns working
```

| | |
|---|---|
| **Pass** | Zero events fired |
| **Fail** | Any event fires for node_modules or .env paths |

---

### TEST 3 — Hash dedup prevents duplicate events

**What this tests:** Saving the same file content twice should only fire **one** event. The SHA-256 hash cache compares content before emitting. Identical content = no second event.

**Terminal 1 — Ctrl+C, then save and run:**

```bash
cat > ~/Desktop/test3.js << 'EOF'
const { FileWatcher } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const fs = require('fs');
const w = new FileWatcher('/tmp/qtest', { projectId: 'test' });
let count = 0;
w.on('context-captured', (items) => {
  count++;
  console.log('Event #' + count + ':', items[0].content.slice(0, 50));
});
w.watch();
console.log('Testing hash dedup...');
setTimeout(() => {
  fs.writeFileSync('/tmp/qtest/dup.ts', '// same content every time');
  console.log('First write done');
}, 500);
setTimeout(() => {
  fs.writeFileSync('/tmp/qtest/dup.ts', '// same content every time');
  console.log('Second write done (same content)');
}, 1200);
setTimeout(() => {
  console.log('Total events:', count);
  console.log(count === 1 ? 'PASS - dedup working' : 'FAIL - expected 1 got ' + count);
  w.close();
}, 3000);
EOF
node ~/Desktop/test3.js
```

**Expected output:**

```
Testing hash dedup...
First write done
Event #1: // same content every time
Second write done (same content)
Total events: 1
PASS - dedup working
```

| | |
|---|---|
| **Pass** | Exactly 1 event total |
| **Fail** | 2 events — hash cache not applied |

---

### TEST 4 — TerminalCapture captures a real command

**What this tests:** TerminalCapture listens on `/tmp/qunoqu.sock`, receives a JSON payload (as from shell integration), parses it, and emits `terminal-event`. **Important:** `timestamp` must be `Date.now()` (number), and the payload must end with `\n`.

**Terminal 1 — Ctrl+C, then save and run:**

```bash
cat > ~/Desktop/test4.js << 'EOF'
const { TerminalCapture } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const net = require('net');
const tc = new TerminalCapture({ projectId: 'test' });
let count = 0;
tc.on('terminal-event', (e) => {
  count++;
  console.log('CAPTURED:', e.command, '-> exitCode:', e.exitCode);
});
tc.start().then(() => {
  console.log('Listening on:', tc.getSocketPath());
  setTimeout(() => {
    const client = net.createConnection(tc.getSocketPath());
    client.on('connect', () => {
      console.log('Connected - sending command...');
      const payload = JSON.stringify({
        command: 'npm run build',
        exitCode: 0,
        cwd: '/tmp/qtest',
        output: 'build successful',
        timestamp: Date.now(),
        projectId: 'test'
      });
      client.write(payload + '\n');
      client.end();
    });
    client.on('error', (err) => console.log('Socket error:', err.message));
  }, 500);
  setTimeout(() => {
    console.log('Total events:', count);
    console.log(count === 1 ? 'PASS - terminal capture working' : 'FAIL - expected 1 got ' + count);
    tc.stop();
  }, 3000);
});
EOF
node ~/Desktop/test4.js
```

**Expected output:**

```
Listening on: /tmp/qunoqu.sock
Connected - sending command...
CAPTURED: npm run build -> exitCode: 0
Total events: 1
PASS - terminal capture working
```

| | |
|---|---|
| **Pass** | 1 event with correct command and exitCode |
| **Fail** | 0 events — e.g. timestamp must be `Date.now()` not `new Date().toISOString()` |

---

### TEST 5 — TerminalCapture filters noise commands

**What this tests:** Commands `ls`, `cd`, `pwd`, `echo` are treated as noise and must be filtered out. Zero events should fire.

**Terminal 1 — Ctrl+C, then save and run:**

```bash
cat > ~/Desktop/test5.js << 'EOF'
const { TerminalCapture } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const net = require('net');
const tc = new TerminalCapture({ projectId: 'test' });
let count = 0;
tc.on('terminal-event', () => {
  count++;
  console.log('FAIL - noise command leaked, count:', count);
});
tc.start().then(() => {
  console.log('Testing noise filter - silence means passing...');
  const noiseCommands = ['ls', 'cd /tmp', 'pwd', 'echo hello'];
  let delay = 500;
  noiseCommands.forEach(cmd => {
    setTimeout(() => {
      const client = net.createConnection(tc.getSocketPath());
      client.on('connect', () => {
        const payload = JSON.stringify({
          command: cmd,
          exitCode: 0,
          cwd: '/tmp',
          output: '',
          timestamp: Date.now(),
          projectId: 'test'
        });
        client.write(payload + '\n');
        client.end();
        console.log('Sent noise command:', cmd);
      });
      client.on('error', (err) => console.log('error:', err.message));
    }, delay);
    delay += 300;
  });
  setTimeout(() => {
    console.log('Total leaked events:', count);
    console.log(count === 0 ? 'PASS - noise filter working' : 'FAIL - ' + count + ' noise commands leaked');
    tc.stop();
  }, 3000);
});
EOF
node ~/Desktop/test5.js
```

**Expected output:**

```
Testing noise filter - silence means passing...
Sent noise command: ls
Sent noise command: cd /tmp
Sent noise command: pwd
Sent noise command: echo hello
Total leaked events: 0
PASS - noise filter working
```

| | |
|---|---|
| **Pass** | Zero events |
| **Fail** | Any event fires |

---

### TEST 6 — Both watchers coexist without conflicts

**What this tests:** FileWatcher and TerminalCapture run at the same time with no crashes, port conflicts, or interference. Both must capture their respective events.

**Terminal 1 — Ctrl+C, then save and run:**

```bash
cat > ~/Desktop/test6.js << 'EOF'
const { FileWatcher, TerminalCapture } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js');
const net = require('net');
const fs = require('fs');
const fw = new FileWatcher('/tmp/qtest', { projectId: 'test' });
const tc = new TerminalCapture({ projectId: 'test' });
let fileCount = 0;
let termCount = 0;
fw.on('context-captured', (items) => {
  fileCount++;
  console.log('[FILE] captured:', items[0].type, '-', items[0].filePath.split('/').pop());
});
tc.on('terminal-event', (e) => {
  termCount++;
  console.log('[TERM] captured:', e.command, '-> exit:', e.exitCode);
});
fw.watch();
tc.start().then(() => {
  console.log('Both watchers running...');
  setTimeout(() => {
    const client = net.createConnection(tc.getSocketPath());
    client.on('connect', () => {
      const payload = JSON.stringify({
        command: 'npm run build',
        exitCode: 0,
        cwd: '/tmp/qtest',
        output: 'success',
        timestamp: Date.now(),
        projectId: 'test'
      });
      client.write(payload + '\n');
      client.end();
    });
    client.on('error', (err) => console.log('Socket error:', err.message));
  }, 500);
  setTimeout(() => {
    fs.writeFileSync('/tmp/qtest/combined.ts', '// decided to use Redis because Postgres was too slow');
  }, 800);
  setTimeout(() => {
    console.log('');
    console.log('File events:', fileCount, fileCount > 0 ? 'PASS' : 'FAIL');
    console.log('Term events:', termCount, termCount > 0 ? 'PASS' : 'FAIL');
    console.log(fileCount > 0 && termCount > 0 ? 'BOTH WATCHERS WORKING' : 'SOMETHING FAILED');
    fw.close();
    tc.stop();
  }, 3000);
});
EOF
node ~/Desktop/test6.js
```

**Expected output:**

```
Both watchers running...
[TERM] captured: npm run build -> exit: 0
[FILE] captured: architecture-decision - combined.ts

File events: 1 PASS
Term events: 1 PASS
BOTH WATCHERS WORKING
```

| | |
|---|---|
| **Pass** | Both `[FILE]` and `[TERM]` events appear |
| **Fail** | Either count is 0 |

---

### TEST 7 — Graceful shutdown, no zombie socket

**What this tests:** After stopping both watchers, the socket file `/tmp/qunoqu.sock` must be removed and no processes left behind. Restarting immediately after shutdown must work (no EADDRINUSE).

Run after Test 6 completes (no separate script):

```bash
ls /tmp/qunoqu.sock 2>&1
ps aux | grep qunoqu | grep -v grep
node -e "const { TerminalCapture } = require('/Users/aryan/Desktop/qunoqu-core/packages/core/dist/index.js'); const tc = new TerminalCapture(); tc.start().then(() => { console.log('PASS - restarted cleanly'); tc.stop(); });"
```

**Expected output:**

```
ls: /tmp/qunoqu.sock: No such file or directory
(empty — no zombie processes)
PASS - restarted cleanly
```

| | |
|---|---|
| **Pass** | Socket gone, clean restart works |
| **Fail** | EADDRINUSE on restart — socket not cleaned up |

---

### TEST 8 — Privacy check, zero network connections

**What this tests:** While watchers are running, there should be **no** outgoing network connections. All data stays local.

Run while any watcher is active:

```bash
sudo lsof -i -P -n | grep node | grep -v "127.0.0.1\|localhost"
```

**Expected output:** Empty (no external connections).

| | |
|---|---|
| **Pass** | No output |
| **Fail** | Any HTTP/HTTPS connection to an external IP |

---

## API Reference (exact method names)

Teammates must use these names:

| Component | Constructor | Start | Stop | Other |
|-----------|-------------|-------|------|--------|
| **FileWatcher** | `new FileWatcher(projectDir: string, options?: { projectId?: string, ignore?: string[] })` | `watch()` — **not** `start()` | `close()` | — |
| **TerminalCapture** | `new TerminalCapture(options?: { socketPath?: string, projectId?: string })` | `start()` — returns `Promise`, must be awaited | `stop()` | `getSocketPath()` |

**Events:**

- **FileWatcher:** `"context-captured"` — callback receives `ContextItem[]`.
- **TerminalCapture:** `"terminal-event"` — callback receives `TerminalEvent`.

**TerminalCapture payload format** (sent over socket; must end with `\n`):

```json
{
  "command": "string",
  "exitCode": 0,
  "cwd": "string",
  "output": "string",
  "timestamp": 1234567890123,
  "projectId": "string"
}
```

`timestamp` must be a **number** (e.g. `Date.now()`), not an ISO string.

---

## Sprint 1 Done Criteria

- [ ] **14 unit tests pass, 0 skipped** (`npm test`)
- [ ] **FileWatcher** detects architecture decisions within 2 seconds of file save
- [ ] **Ignore patterns** enforced — `node_modules` and `.env` produce zero events
- [ ] **Hash dedup** — identical content fires exactly 1 event
- [ ] **Both watchers coexist** — FileWatcher and TerminalCapture run simultaneously
- [ ] **CI green** on GitHub Actions

---

## Known Limitations

- **Shell integration script** (`~/.qunoqu/shell-integration.sh`) is not yet generated automatically; that is planned for the CLI (Sprint 4). Terminal behaviour is tested via socket simulation.
- **VS Code extension** and **CLI** are scaffolded only; full functionality is Sprint 4.
- **No persistent storage yet** — Sprint 2 adds SQLite and ChromaDB.

---

## What’s Next — Sprint 2

- **feat/storage-layer** — SQLite metadata store (`MetadataStore` class)
- **feat/embedding-pipeline** — ChromaDB vector store + Ollama embeddings (`VectorStore` class)
