#!/usr/bin/env node
/**
 * @qunoqu/cli – CLI entrypoint
 */

import { hello, SHELL_INTEGRATION_SCRIPT, detectProjectId } from "@qunoqu/core";
import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const QUNOQU_DIR = join(homedir(), ".qunoqu");
const SHELL_SCRIPT_PATH = join(QUNOQU_DIR, "shell-integration.sh");

/**
 * Exact Cursor MCP config format (.cursor/mcp.json):
 *
 * {
 *   "mcpServers": {
 *     "qunoqu": {
 *       "command": "node",
 *       "args": ["/absolute/path/to/run-mcp.js"],
 *       "env": {
 *         "QUNOQU_PROJECT_ID": "<optional project id for default scope>"
 *       }
 *     }
 *   }
 * }
 *
 * Cursor reads project-level .cursor/mcp.json from the workspace root.
 * Restart Cursor after changing this file.
 */

async function cmdInit(): Promise<void> {
  await mkdir(QUNOQU_DIR, { recursive: true });
  await writeFile(SHELL_SCRIPT_PATH, SHELL_INTEGRATION_SCRIPT, "utf-8");
  console.log("Wrote", SHELL_SCRIPT_PATH);
  console.log("");
  console.log("Add to your shell config (~/.bashrc or ~/.zshrc):");
  console.log("");
  console.log("  source ~/.qunoqu/shell-integration.sh");
  console.log("");
  console.log("Then start the qunoqu daemon so it listens on /tmp/qunoqu.sock.");
}

/** Resolve path to @qunoqu/core dist/run-mcp.js (works when cli depends on core or monorepo sibling). */
function resolveRunMcpPath(cwd: string): string {
  const cliDir = dirname(fileURLToPath(import.meta.url));
  // Monorepo: CLI at packages/cli/dist -> core at packages/core/dist/run-mcp.js
  const siblingCoreRunMcp = join(cliDir, "..", "..", "core", "dist", "run-mcp.js");
  if (existsSync(siblingCoreRunMcp)) return siblingCoreRunMcp;

  const require = createRequire(import.meta.url);
  const searchPaths = [cwd, join(cliDir, "..", "..", ".."), join(cliDir, "..")];
  for (const p of searchPaths) {
    try {
      const corePkgPath = require.resolve("@qunoqu/core/package.json", { paths: [p] });
      return join(dirname(corePkgPath), "dist", "run-mcp.js");
    } catch {
      continue;
    }
  }
  throw new Error("Could not resolve @qunoqu/core. Run from a project that has @qunoqu/core installed (e.g. npm install @qunoqu/core).");
}

async function cmdConfigCursor(): Promise<void> {
  const cwd = process.cwd();
  const cursorDir = join(cwd, ".cursor");
  const mcpPath = join(cursorDir, "mcp.json");

  let runMcpPath: string;
  try {
    runMcpPath = resolveRunMcpPath(cwd);
  } catch {
    console.error("Could not resolve @qunoqu/core. Run from a project that has @qunoqu/core installed (e.g. npm install @qunoqu/core).");
    process.exit(1);
  }

  const projectId = detectProjectId(cwd);
  const config = {
    mcpServers: {
      qunoqu: {
        command: "node",
        args: [runMcpPath],
        env: { QUNOQU_PROJECT_ID: projectId },
      },
    },
  };

  await mkdir(cursorDir, { recursive: true });
  await writeFile(mcpPath, JSON.stringify(config, null, 2), "utf-8");
  console.log("Wrote", mcpPath);
  console.log("  QUNOQU_PROJECT_ID:", projectId);
  console.log("  Run MCP script:", runMcpPath);
  console.log("");
  console.log("Restart Cursor for the MCP server to load.");
}

function main(): void {
  const arg = process.argv[2];
  const sub = process.argv[3];

  if (arg === "init") {
    cmdInit().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    return;
  }

  if (arg === "config" && sub === "cursor") {
    cmdConfigCursor().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    return;
  }

  console.log(hello());
}

main();
