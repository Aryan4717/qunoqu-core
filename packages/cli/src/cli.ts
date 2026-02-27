#!/usr/bin/env node
/**
 * @qunoqu/cli – npx-compatible CLI (init, status, recall, doctor)
 */

import { program } from "commander";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import {
  detectProjectId,
  SHELL_INTEGRATION_SCRIPT,
  MetadataStore,
  startServer,
  ensureApiToken,
  DEFAULT_API_PID_PATH,
} from "@qunoqu/core";
import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const QUNOQU_DIR = join(homedir(), ".qunoqu");
const SHELL_SCRIPT_PATH = join(QUNOQU_DIR, "shell-integration.sh");
const CONFIG_FILENAME = ".qunoqu-config.json";
const CLI_VERSION = "0.0.0";

export interface QunoquConfig {
  projectId: string;
  createdAt: number;
  version: string;
}

function getProjectRoot(): string {
  try {
    const out = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return (out && out.trim()) || process.cwd();
  } catch {
    return process.cwd();
  }
}

async function loadConfig(projectRoot: string): Promise<QunoquConfig | null> {
  const path = join(projectRoot, CONFIG_FILENAME);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as QunoquConfig;
  } catch {
    return null;
  }
}

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
  const root = getProjectRoot();
  const projectId = detectProjectId(root);

  const spinner = ora("Setting up Qunoqu…").start();
  try {
    await mkdir(QUNOQU_DIR, { recursive: true });
    await writeFile(SHELL_SCRIPT_PATH, SHELL_INTEGRATION_SCRIPT, "utf-8");

    const config: QunoquConfig = {
      projectId,
      createdAt: Date.now(),
      version: CLI_VERSION,
    };
    await writeFile(join(root, CONFIG_FILENAME), JSON.stringify(config, null, 2), "utf-8");

    spinner.succeed("Qunoqu initialized.");
  } catch (e) {
    spinner.fail("Init failed.");
    throw e;
  }

  const msg = [
    chalk.bold("Next steps:"),
    "",
    "1. Add to your shell config (~/.bashrc or ~/.zshrc):",
    chalk.cyan("   source ~/.qunoqu/shell-integration.sh"),
    "",
    "2. Restart your terminal or run: source ~/.qunoqu/shell-integration.sh",
    "",
    "3. (Optional) Configure Cursor MCP:",
    chalk.cyan("   npx qunoqu config cursor"),
    "",
    "4. Use the VS Code extension or MCP to capture and recall memories.",
  ].join("\n");

  console.log(boxen(msg, { padding: 1, borderColor: "green" }));
}

async function cmdStatus(): Promise<void> {
  const root = getProjectRoot();
  const store = new MetadataStore();
  const projects = store.listProjects();
  const project = projects.find((p) => p.root_path === root);
  const projectId = project?.id ?? (await loadConfig(root))?.projectId ?? detectProjectId(root);
  const items = projectId ? store.getByProject(projectId) : [];
  store.close();

  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const memoriesToday = items.filter((i) => i.created_at >= todayMs).length;
  const lastCapture = items.length > 0 ? Math.max(...items.map((i) => i.created_at)) : null;

  let ollamaStatus: string;
  try {
    const res = await fetch("http://localhost:11434/api/tags", { method: "GET" });
    ollamaStatus = res.ok ? chalk.green("running") : chalk.red("not running");
  } catch {
    ollamaStatus = chalk.red("not running");
  }

  let chromaStatus: string;
  try {
    const res = await fetch("http://localhost:8000/api/v1/heartbeat", { method: "GET" });
    chromaStatus = res.ok ? chalk.green("accessible") : chalk.red("not accessible");
  } catch {
    chromaStatus = chalk.red("not accessible");
  }

  const mcpPath = join(root, ".cursor", "mcp.json");
  const mcpStatus = existsSync(mcpPath) ? chalk.green("configured") : chalk.red("not configured");

  console.log(chalk.bold("\n Qunoqu status\n"));
  console.log("  Total memories:     ", items.length);
  console.log("  Memories today:     ", memoriesToday);
  console.log("  Last capture:       ", lastCapture ? new Date(lastCapture).toISOString() : "never");
  console.log("  Ollama:             ", ollamaStatus);
  console.log("  ChromaDB:           ", chromaStatus);
  console.log("  MCP (Cursor):       ", mcpStatus);
  console.log("");
}

async function cmdRecall(query: string): Promise<void> {
  const root = getProjectRoot();
  const store = new MetadataStore();
  const projects = store.listProjects();
  const project = projects.find((p) => p.root_path === root);
  const projectId = project?.id ?? (await loadConfig(root))?.projectId ?? detectProjectId(root);

  const results = projectId
    ? (query.trim()
        ? store.keywordSearch(query, { projectId, limit: 15 })
        : store.getByProject(projectId).slice(0, 15))
    : [];
  store.close();

  if (results.length === 0) {
    console.log(chalk.gray("No memories found."));
    return;
  }

  const typeIcon: Record<string, string> = {
    file_change: "📄",
    terminal_cmd: "⌨",
    decision: "✓",
    comment: "💬",
  };

  console.log(chalk.bold("\n Recall: ") + (query || "(recent)\n"));
  for (const r of results) {
    const icon = typeIcon[r.type] ?? "•";
    const preview = r.content.slice(0, 80) + (r.content.length > 80 ? "…" : "");
    const file = r.file_path ? chalk.cyan(r.file_path) : chalk.gray("(no file)");
    const ts = new Date(r.created_at).toISOString();
    console.log(`  ${icon} ${chalk.dim(ts)} ${file}`);
    console.log(`    ${preview}`);
    console.log("");
  }
}

async function cmdDoctor(): Promise<void> {
  const root = getProjectRoot();

  const checks: { name: string; ok: boolean; fix: string }[] = [];

  try {
    const res = await fetch("http://localhost:11434/api/tags", { method: "GET" });
    checks.push({
      name: "Ollama running",
      ok: res.ok,
      fix: "Start Ollama: ollama serve (or install from https://ollama.ai)",
    });
  } catch {
    checks.push({
      name: "Ollama running",
      ok: false,
      fix: "Start Ollama: ollama serve (or install from https://ollama.ai)",
    });
  }

  try {
    const res = await fetch("http://localhost:8000/api/v1/heartbeat", { method: "GET" });
    checks.push({
      name: "ChromaDB accessible",
      ok: res.ok,
      fix: "Run: chroma run --path /tmp/chroma (or pip install chromadb && chroma run --path /tmp/chroma)",
    });
  } catch {
    checks.push({
      name: "ChromaDB accessible",
      ok: false,
      fix: "Run: chroma run --path /tmp/chroma (or pip install chromadb && chroma run --path /tmp/chroma)",
    });
  }

  const shellPath = SHELL_SCRIPT_PATH;
  const shellExists = existsSync(shellPath);
  checks.push({
    name: "Shell integration script",
    ok: shellExists,
    fix: "Run: npx qunoqu init (writes ~/.qunoqu/shell-integration.sh). Then add: source ~/.qunoqu/shell-integration.sh to ~/.zshrc or ~/.bashrc",
  });

  const mcpPath = join(root, ".cursor", "mcp.json");
  const mcpExists = existsSync(mcpPath);
  checks.push({
    name: "MCP config (Cursor)",
    ok: mcpExists,
    fix: "Run: npx qunoqu config cursor (writes .cursor/mcp.json). Restart Cursor.",
  });

  console.log(chalk.bold("\n Qunoqu doctor\n"));
  for (const c of checks) {
    const sym = c.ok ? chalk.green("✓") : chalk.red("✗");
    console.log(`  ${sym} ${c.name}`);
    if (!c.ok) console.log(chalk.dim(`    → ${c.fix}`));
  }
  console.log("");
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

async function cmdServerStart(): Promise<void> {
  ensureApiToken();
  const { server, port } = await startServer();
  writeFileSync(DEFAULT_API_PID_PATH, String(process.pid), "utf-8");
  server.on("close", () => {
    try {
      unlinkSync(DEFAULT_API_PID_PATH);
    } catch {
      // ignore
    }
  });
  console.log(chalk.green("Qunoqu REST API listening on"), chalk.cyan(`http://localhost:${port}`));
  console.log(chalk.dim("Token: ~/.qunoqu/api-token (use as Bearer token)"));
  console.log(chalk.dim("Stop with: qunoqu server stop"));
}

function cmdServerStop(): void {
  if (!existsSync(DEFAULT_API_PID_PATH)) {
    console.log(chalk.yellow("No pid file found. Server may not be running."));
    return;
  }
  try {
    const pid = parseInt(readFileSync(DEFAULT_API_PID_PATH, "utf-8").trim(), 10);
    process.kill(pid, "SIGTERM");
    unlinkSync(DEFAULT_API_PID_PATH);
    console.log(chalk.green("Server stopped."));
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ESRCH") {
      unlinkSync(DEFAULT_API_PID_PATH);
      console.log(chalk.yellow("Process was not running; cleaned pid file."));
    } else {
      throw e;
    }
  }
}

function main(): void {
  program
    .name("qunoqu")
    .description("Qunoqu – developer memory for AI")
    .version(CLI_VERSION);

  program
    .command("init")
    .description("Set up project, shell integration, and config")
    .action(() => cmdInit().catch((err) => { console.error(err); process.exit(1); }));

  program
    .command("status")
    .description("Show memory stats and service status")
    .action(() => cmdStatus().catch((err) => { console.error(err); process.exit(1); }));

  program
    .command("recall [query]")
    .description("Search memories (keyword). Omit query for recent items.")
    .action((query: string) => cmdRecall(query ?? "").catch((err) => { console.error(err); process.exit(1); }));

  program
    .command("doctor")
    .description("Diagnose setup (Ollama, ChromaDB, shell, MCP)")
    .action(() => cmdDoctor().catch((err) => { console.error(err); process.exit(1); }));

  program
    .command("config cursor")
    .description("Write .cursor/mcp.json for Cursor IDE")
    .action(() => cmdConfigCursor().catch((err) => { console.error(err); process.exit(1); }));

  const server = program
    .command("server")
    .description("Manage the Qunoqu REST API server (start/stop)");

  server
    .command("start")
    .description("Start the REST API server (localhost:7384)")
    .action(() => cmdServerStart().catch((err) => { console.error(err); process.exit(1); }));

  server
    .command("stop")
    .description("Stop the REST API server")
    .action(() => {
      try {
        cmdServerStop();
      } catch (err) {
        console.error(err);
        process.exit(1);
      }
    });

  program.parse(process.argv);

  if (process.argv.length <= 2) {
    program.outputHelp();
  }
}

main();
