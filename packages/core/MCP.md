# Qunoqu MCP Server

MCP server that exposes the qunoqu memory layer to AI tools (Claude Desktop, Cursor, MCP Inspector). Uses **stdio** transport.

## Tools

| Tool | Description |
|------|-------------|
| **recall_context** | Hybrid search (vector + keyword) over project memory. Returns top K relevant context items with source info. |
| **save_decision** | Saves a decision to the decisions table and knowledge graph. |
| **get_project_summary** | Returns last 10 context items, top decisions, knowledge graph summary, and active file list for a project. |

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

## Error handling

If storage (SQLite, ChromaDB, or Ollama) is unavailable, tools return a helpful error message instead of crashing. Vector search is skipped when Chroma/Ollama is down; keyword-only recall still works.
