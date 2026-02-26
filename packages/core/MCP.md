# Qunoqu MCP Server

MCP server that exposes the qunoqu memory layer to AI tools (Claude Desktop, Cursor, MCP Inspector). Uses **stdio** transport.

## Tools

| Tool | Description |
|------|-------------|
| **recall_context** | Hybrid search (vector + keyword) over project memory. Returns top K relevant context items with source info. |
| **save_decision** | Saves a decision to the decisions table and knowledge graph. |
| **get_project_summary** | Returns last 10 context items, top decisions, knowledge graph summary, and active file list for a project. |
| **list_projects** | Lists all known projects with context item counts and last active timestamps. |

## Running the server

From the repo root after building:

```bash
cd packages/core && npm run build && node dist/run-mcp.js
```

Or point Claude Desktop / MCP Inspector at `dist/run-mcp.js` with the `node` command.

## Claude Desktop configuration

Add this to your Claude Desktop config file under `mcpServers`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "qunoqu": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/qunoqu-core/packages/core/dist/run-mcp.js"],
      "env": {}
    }
  }
}
```

Replace `/ABSOLUTE/PATH/TO/qunoqu-core` with the actual path to your qunoqu-core repo (e.g. `/Users/you/qunoqu-core`).

## Cursor IDE configuration

**Exact Cursor `.cursor/mcp.json` format** (project-level; commit to share with team):

```json
{
  "mcpServers": {
    "qunoqu": {
      "command": "node",
      "args": ["/absolute/path/to/run-mcp.js"],
      "env": {
        "QUNOQU_PROJECT_ID": "<optional; auto-detected project id for default scope>"
      }
    }
  }
}
```

Generate this file and auto-detect project ID from the current directory:

```bash
npx qunoqu config cursor
```

This writes `.cursor/mcp.json` and sets `QUNOQU_PROJECT_ID` from git remote, `package.json` name+version, or directory name. Restart Cursor after changing the file. The server accepts `projectId` from tool arguments or from `QUNOQU_PROJECT_ID` at startup (multiple projects supported when passing `projectId` explicitly).

## Error handling

If storage (SQLite, ChromaDB, or Ollama) is unavailable, tools return a helpful error message instead of crashing. Vector search is skipped when Chroma/Ollama is down; keyword-only recall still works.
