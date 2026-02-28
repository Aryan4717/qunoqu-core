# Qunoqu — User Guide

> **Developer memory for AI.** Qunoqu captures what you build, why you built it, and makes that context available to every AI tool you use — Cursor, Claude Desktop, Claude Code, Gemini CLI — all sharing the same memory.

---

## What is Qunoqu?

When you work on a project, you make hundreds of decisions. Why did we choose WebSockets over polling? Why is this file structured this way? What was the rationale for this database schema? 

Normally that context lives in your head or gets lost. When you switch AI tools, you repeat yourself. When a teammate joins, they have no context.

**Qunoqu fixes this.** It captures your decisions, file changes, and terminal commands, stores them in a memory layer, and makes them instantly queryable by any AI tool you use. Every tool sees the same memory. You never repeat yourself.

---

## Before You Start — What You Need

### Required
- **Node.js 18+** — check with `node --version`
- **A project with git** — Qunoqu uses git to identify your project
- **At least one AI tool** — Cursor, Claude Desktop, Claude Code, or Gemini CLI

### Optional (for semantic/vector search)
- **Ollama** — for AI-powered semantic search (find related memories even without exact keywords)
- **ChromaDB** — vector database that works with Ollama

> **Without Ollama/ChromaDB:** Qunoqu uses keyword search. Still very useful.
> **With Ollama/ChromaDB:** Qunoqu uses semantic search. Much more powerful.

---

## Setup — 3 Steps

### Step 1 — Install Qunoqu in your project

```bash
# Navigate to your project
cd your-project

# Initialize Qunoqu (run once per project)
npx qunoqu init
```

This creates:
- `.qunoqu-config.json` in your project root — stores your project ID
- `~/.qunoqu/shell-integration.sh` — captures terminal commands automatically

**Then add shell integration to your terminal:**

Mac/Linux — add to `~/.zshrc` or `~/.bashrc`:
```bash
echo 'source ~/.qunoqu/shell-integration.sh' >> ~/.zshrc
source ~/.zshrc
```

Windows — add to PowerShell profile:
```powershell
. "$env:USERPROFILE\.qunoqu\shell-integration.ps1"
```

### Step 2 — Connect your AI tools

```bash
# Connect all tools at once (recommended)
npx qunoqu config all
```

Or connect individually:
```bash
npx qunoqu config cursor          # Cursor IDE
npx qunoqu config claude-desktop  # Claude Desktop app
npx qunoqu config claude-code     # Claude Code (terminal)
npx qunoqu config gemini          # Gemini CLI
```

**After running this:**
- Restart Cursor
- Restart Claude Desktop
- Claude Code and Gemini CLI — no restart needed

### Step 3 — Verify everything works

```bash
npx qunoqu doctor
```

You should see ✓ for every tool you have installed. Any ✗ shows exactly how to fix it.

---

## What Gets Captured

Qunoqu captures context from 4 sources:

| Source | What it captures | How |
|--------|-----------------|-----|
| File changes | Code you write, architecture decisions in comments | FileWatcher monitors your project |
| Terminal commands | Commands you run and their context | Shell integration script |
| Decisions | Explicit decisions you save | Via AI tools or CLI |
| Comments | Architecture notes in your code | Extracted automatically |

### What does NOT get captured (Privacy Filter)

Qunoqu automatically drops and redacts sensitive content before anything is stored:

**Dropped entirely:**
- `.env` files
- `*.key`, `*.pem` files
- Files matching `*secret*`, `*credential*`, `*password*`
- `node_modules/`, `dist/`, `build/`, `.git/`

**Redacted in content (replaced with `[REDACTED]`):**
- API keys and tokens
- JWT tokens
- Private keys
- Passwords in code
- Credit card numbers

You can add custom ignore patterns by creating `.qunoqu-ignore` in your project root (same format as `.gitignore`).

---

## What You Can Ask Your AI Tools

Once connected, your AI tools can answer questions about your project memory. Here is what you can ask:

### Finding past decisions

```
recall_context why did we choose WebSockets
recall_context database schema decisions  
recall_context why is the auth structured this way
recall_context performance optimizations we made
```

### Getting project overview

```
get_project_summary
list_projects
```

### Saving new decisions

```
save_decision title="Use Redis for sessions" rationale="Postgres was too slow for session lookups at scale"
```

### Searching by topic

```
recall_context authentication
recall_context error handling
recall_context API design
recall_context deployment
```

---

## Using Each AI Tool

### Cursor

After `qunoqu config cursor` and restarting Cursor:

1. Open Cursor chat (Cmd+L)
2. Look for the hammer 🔨 icon — this means MCP tools are connected
3. Ask anything about your project:

```
What decisions did we make about the database?
recall_context WebSockets
Why is the payment service structured this way?
```

Cursor will automatically call the Qunoqu tools and return answers from your project memory.

### Claude Desktop

After `qunoqu config claude-desktop` and restarting Claude Desktop:

1. Open a new chat
2. Click the + button → you should see qunoqu in the tools list
3. Ask anything:

```
list_projects
recall_context authentication decisions
get_project_summary
```

Claude Desktop reads from the exact same memory as Cursor. All context is shared.

### Claude Code

After `qunoqu config claude-code`:

```bash
cd your-project
claude
```

Then ask:
```
use qunoqu to recall context about our WebSocket implementation
what decisions are stored about the database?
list all projects in qunoqu memory
```

Claude Code shares the same memory as Cursor and Claude Desktop. Switch between tools freely — context follows you.

### Gemini CLI

After `qunoqu config gemini`:

```bash
cd your-project
gemini
```

Then ask:
```
use the qunoqu list_projects tool
recall context about authentication
get a summary of this project
```

> **Note:** Gemini CLI may ask you to approve tool calls the first time. Type `y` to allow.

---

## The 4 MCP Tools Available in Every AI Tool

Every connected AI tool has access to these 4 tools:

### `recall_context`
Hybrid search — keyword + semantic. Finds relevant memories even if you don't use exact words.

**Parameters:**
- `query` — what you're looking for (natural language)
- `projectId` — which project (auto-detected if `QUNOQU_PROJECT_ID` is set)
- `topK` — how many results (default 5, max 20)

**Example:**
```
recall_context query="why did we choose this database" topK=10
```

### `save_decision`
Save an important decision to memory permanently.

**Parameters:**
- `title` — short name for the decision
- `rationale` — the full explanation
- `projectId` — which project

**Example:**
```
save_decision title="Use TypeScript strict mode" rationale="Catches bugs at compile time, reduces runtime errors by 40%"
```

### `get_project_summary`
Returns a full project overview: last 10 context items, all decisions, knowledge graph nodes, active files.

**Parameters:**
- `projectId` — which project

**Example:**
```
get_project_summary
```

### `list_projects`
Lists all projects in memory with context counts and last active timestamps.

**Example:**
```
list_projects
```

---

## CLI Commands Reference

```bash
# Setup
npx qunoqu init                    # Initialize project (run once)
npx qunoqu config all              # Connect all AI tools
npx qunoqu config cursor           # Connect Cursor only
npx qunoqu config claude-desktop   # Connect Claude Desktop only
npx qunoqu config claude-code      # Connect Claude Code only
npx qunoqu config gemini           # Connect Gemini CLI only

# Daily use
npx qunoqu recall                  # Show recent memories
npx qunoqu recall WebSockets       # Search memories by keyword
npx qunoqu status                  # Show memory stats and tool status
npx qunoqu doctor                  # Diagnose any setup issues
npx qunoqu debug                   # Show detected environment (for troubleshooting)
```

---

## Optional: Semantic Search with Ollama + ChromaDB

By default Qunoqu uses keyword search. If you install Ollama and ChromaDB, search becomes semantic — meaning you can find related memories even without exact keywords.

**Example difference:**
- Keyword search for "latency" — finds items containing the word "latency"
- Semantic search for "latency" — finds items about performance, speed, response time, even if they never say "latency"

### Install Ollama

```bash
# Mac
brew install ollama

# Then start it
ollama serve

# Pull the embedding model
ollama pull nomic-embed-text
```

### Install ChromaDB

**Option A — Use from Qunoqu repo (no Python needed):**

```bash
cd /path/to/qunoqu-core
npx chroma run --path ~/.qunoqu/chroma
```

**Option B — Python:**

```bash
pip install chromadb
# Ensure pip's bin is on PATH (e.g. ~/.local/bin or Python's Scripts folder), then:
chroma run --path ~/.qunoqu/chroma
```

If you get a permission error on `~/.qunoqu/chroma`, use a writable path instead, e.g. `--path /tmp/qunoqu-chroma`.

### Verify it's working

```bash
npx qunoqu doctor
```

Ollama and ChromaDB should show ✓.

> **Note:** Ollama and ChromaDB must be running whenever you use Qunoqu for semantic search. Add them to your startup if you want them always available.

---

## Confirming Memory is Shared Between Tools

To verify all your tools are reading from the same memory:

**Step 1 — Save a test decision in Claude Desktop:**
```
save_decision title="Test shared memory" rationale="Testing that all tools share the same Qunoqu memory"
```

**Step 2 — Recall it in Cursor:**
```
recall_context shared memory test
```

**Step 3 — Recall it in Claude Code:**
```bash
claude -p "use qunoqu recall_context to search for 'shared memory test'"
```

**Step 4 — Recall it in Gemini:**
```bash
gemini
# then type: recall context about shared memory test
```

All 4 tools should return the same decision. This confirms shared memory is working.

---

## Troubleshooting

### "No projects in memory yet"
Your project hasn't been initialized or no context has been captured yet.
```bash
npx qunoqu init
npx qunoqu status
```

### "Tool execution denied by policy" (Gemini)
Gemini requires interactive approval for tool calls.
```bash
gemini  # open interactive mode
# then type your query
# approve tool calls with 'y'
```

### MCP tools not showing in Cursor
1. Check Cursor Settings → Tools & MCP → qunoqu should be green
2. If not: `npx qunoqu config cursor` then restart Cursor

### MCP tools not showing in Claude Desktop
1. Restart Claude Desktop completely (Cmd+Q, not just close window)
2. Open new chat and click + button
3. If still missing: `npx qunoqu config claude-desktop` and restart again

### "recall_context returns nothing relevant"
- Check `npx qunoqu status` — how many memories are stored?
- If 0: no context has been captured yet — make some file changes or save a decision manually
- If >0: try broader search terms

### Privacy log — why is my content missing?
```bash
cat ~/.qunoqu/privacy.log
```
This shows everything that was filtered and why. If your content was dropped, the reason is here.

### See exactly what Qunoqu detects on your machine
```bash
npx qunoqu debug
```
Shows OS, Node path, all tool paths, config locations. Share this output when asking for help.

---

## How Memory Flows

```
You write code / run commands
         ↓
PrivacyFilter — drops secrets, redacts PII
         ↓
MetadataStore (SQLite at ~/.qunoqu/memory.db)
VectorStore (ChromaDB — optional, for semantic search)
KnowledgeGraph (JSON at ~/.qunoqu/graph.json)
         ↓
MCP Server — all AI tools query this
         ↓
Cursor  Claude Desktop  Claude Code  Gemini CLI
   ↑_____________ same memory _____________↑
```

All tools read from `~/.qunoqu/memory.db` on your machine. Memory is local — nothing is sent to the cloud.

---

## Privacy & Security

- **All memory is local** — stored in `~/.qunoqu/` on your machine
- **Secrets are never stored** — PrivacyFilter drops `.env` files and redacts API keys before storage
- **You control what's ignored** — add `.qunoqu-ignore` to your project root
- **Privacy log** — every filtered item is logged at `~/.qunoqu/privacy.log` (reason only, never the actual secret)
- **No telemetry** — Qunoqu does not send anything anywhere

---

## Quick Reference Card

| I want to... | Command |
|-------------|---------|
| Set up a new project | `npx qunoqu init` |
| Connect all AI tools | `npx qunoqu config all` |
| Search my memories | `npx qunoqu recall <keyword>` |
| See recent memories | `npx qunoqu recall` |
| Check everything works | `npx qunoqu doctor` |
| See memory stats | `npx qunoqu status` |
| Fix a broken setup | `npx qunoqu doctor` then follow ✗ instructions |
| See what's detected | `npx qunoqu debug` |
| Add semantic search | Install Ollama + ChromaDB (see above) |