#!/usr/bin/env node
/**
 * Stdio entrypoint for the qunoqu MCP server (Claude Desktop, Cursor, MCP inspector).
 * Run: node packages/core/dist/run-mcp.js
 */

import { QunoqMCPServer } from "./QunoqMCPServer.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new QunoqMCPServer();
const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("qunoqu MCP server failed to start:", err);
  process.exit(1);
});
