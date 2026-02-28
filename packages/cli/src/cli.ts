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

const EXEC_OPTS: { encoding: "utf-8"; env: NodeJS.ProcessEnv; stdio: ("pipe" | "ignore")[] } = {
  encoding: "utf-8",
  env: { ...process.env },
  stdio: ["pipe", "pipe", "ignore"],
};

export interface QunoquConfig {
  projectId: string;
  createdAt: number;
  version: string;
}

function getProjectRoot(): string {
  try {
    const out = execSync("git rev-parse --show-toplevel", EXEC_OPTS);
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

function detectToolPath(cmd: string): string | null {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const out = execSync(`${which} ${cmd}`, EXEC_OPTS);
    const first = (out && out.trim().split(/[\r\n]+/)[0]?.trim()) || null;
    return first || null;
  } catch {
    return null;
  }
}

export interface DetectedEnvironment {
  os: string;
  arch: string;
  nodeVersion: string;
  nodePath: string;
  qunoqDir: string;
  claudeDesktopConfigPath: string | null;
  claudePath: string | null;
  geminiPath: string | null;
  runMcpPath: string | null;
  gitPath: string | null;
  restServerRunning: boolean;
  ollamaInstalled: boolean;
  chromaInstalled: boolean;
}

async function detectEnvironment(): Promise<DetectedEnvironment> {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const qunoqDir = join(homedir(), ".qunoqu");

  let claudeDesktopConfigPath: string | null = null;
  if (process.platform === "darwin") {
    claudeDesktopConfigPath = join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  } else if (process.platform === "win32") {
    claudeDesktopConfigPath = join(process.env.APPDATA || homedir(), "Claude", "claude_desktop_config.json");
  } else {
    claudeDesktopConfigPath = join(homedir(), ".config", "Claude", "claude_desktop_config.json");
  }

  const claudePath = detectToolPath("claude");
  const geminiPath = detectToolPath("gemini") ?? detectToolPath("gemini-cli");
  const gitPath = detectToolPath("git");

  let runMcpPath: string | null = null;
  try {
    runMcpPath = resolveRunMcpPath(process.cwd());
  } catch {
    runMcpPath = null;
  }

  let restServerRunning = false;
  try {
    const r = await fetch("http://localhost:7384/health");
    restServerRunning = r.ok;
  } catch {
    /* not running */
  }

  const ollamaInstalled = detectToolPath("ollama") !== null;
  const chromaInstalled = detectToolPath("chroma") !== null || detectToolPath("chromadb") !== null;

  return {
    os,
    arch: process.arch,
    nodeVersion: process.version,
    nodePath: process.execPath,
    qunoqDir,
    claudeDesktopConfigPath,
    claudePath,
    geminiPath,
    runMcpPath,
    gitPath,
    restServerRunning,
    ollamaInstalled,
    chromaInstalled,
  };
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
  const env = await detectEnvironment();
  const root = getProjectRoot();
  const store = new MetadataStore();
  const projects = store.listProjects();
  const project = projects.find((p) => p.root_path === root);
  const projectId = project?.id ?? (await loadConfig(root))?.projectId ?? detectProjectId(root);
  const items = projectId ? store.getByProject(projectId) : [];
  store.close();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const memoriesToday = items.filter((i) => i.created_at >= startOfToday.getTime()).length;
  const lastCapture = items.length > 0 ? Math.max(...items.map((i) => i.created_at)) : null;

  let ollamaStatus: string;
  try {
    const r = await fetch("http://localhost:11434/api/tags");
    ollamaStatus = r.ok ? chalk.green("running") : chalk.red("not running");
  } catch {
    ollamaStatus = env.ollamaInstalled
      ? chalk.yellow("installed but not running")
      : chalk.red("not installed");
  }

  let chromaStatus: string;
  try {
    const r = await fetch("http://localhost:8000/api/v1/heartbeat");
    chromaStatus = r.ok ? chalk.green("running") : chalk.red("not running");
  } catch {
    chromaStatus = env.chromaInstalled
      ? chalk.yellow("installed but not running")
      : chalk.red("not installed");
  }

  const mcpPath = join(root, ".cursor", "mcp.json");

  console.log(chalk.bold("\n Qunoqu status\n"));
  console.log("  OS:                 ", env.os, env.arch);
  console.log("  Node:               ", env.nodeVersion);
  console.log("  Total memories:     ", items.length);
  console.log("  Memories today:     ", memoriesToday);
  console.log("  Last capture:       ", lastCapture ? new Date(lastCapture).toISOString() : "never");
  console.log("  Ollama:             ", ollamaStatus);
  console.log("  ChromaDB:           ", chromaStatus);
  console.log("  REST server:        ", env.restServerRunning ? chalk.green("running") : chalk.red("not running"));
  console.log("  MCP (Cursor):       ", existsSync(mcpPath) ? chalk.green("configured") : chalk.red("not configured"));
  console.log("  Claude Desktop:     ", env.claudeDesktopConfigPath ? chalk.green("installed") : chalk.red("not installed"));
  console.log("  Claude Code:        ", env.claudePath ? chalk.green(env.claudePath) : chalk.red("not installed"));
  console.log("  Gemini CLI:         ", env.geminiPath ? chalk.green(env.geminiPath) : chalk.red("not installed"));
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
  const env = await detectEnvironment();
  const root = getProjectRoot();
  const checks: { name: string; ok: boolean; fix: string }[] = [];

  const nodeMajor = parseInt(env.nodeVersion.replace("v", "").split(".")[0], 10);
  checks.push({
    name: "Node.js >= 18",
    ok: nodeMajor >= 18,
    fix: "Install Node.js 18+ from https://nodejs.org",
  });

  let ollamaRunning = false;
  try {
    const r = await fetch("http://localhost:11434/api/tags");
    ollamaRunning = r.ok;
  } catch {
    /* not running */
  }
  checks.push({
    name: "Ollama running",
    ok: ollamaRunning,
    fix: env.ollamaInstalled
      ? "Ollama installed but not running. Start with: ollama serve"
      : "Install Ollama from https://ollama.ai then run: ollama serve",
  });

  let chromaRunning = false;
  try {
    const r = await fetch("http://localhost:8000/api/v1/heartbeat");
    chromaRunning = r.ok;
  } catch {
    /* not running */
  }
  checks.push({
    name: "ChromaDB running",
    ok: chromaRunning,
    fix: env.chromaInstalled
      ? "ChromaDB installed but not running. Start with: chroma run --path ~/.qunoqu/chroma"
      : "Install with: pip install chromadb then run: chroma run --path ~/.qunoqu/chroma",
  });

  const shellScript = env.os === "windows"
    ? join(env.qunoqDir, "shell-integration.ps1")
    : join(env.qunoqDir, "shell-integration.sh");
  checks.push({
    name: "Shell integration",
    ok: existsSync(shellScript),
    fix: env.os === "windows"
      ? "Run: qunoqu init. Then add to $PROFILE: . \"$env:USERPROFILE\\.qunoqu\\shell-integration.ps1\""
      : "Run: qunoqu init. Then add to ~/.zshrc: source ~/.qunoqu/shell-integration.sh",
  });

  const mcpPath = join(root, ".cursor", "mcp.json");
  checks.push({
    name: "Cursor MCP config",
    ok: existsSync(mcpPath),
    fix: "Run: qunoqu config cursor",
  });

  checks.push({
    name: "Claude Desktop config",
    ok: env.claudeDesktopConfigPath !== null && existsSync(env.claudeDesktopConfigPath),
    fix: env.claudeDesktopConfigPath
      ? "Run: qunoqu config claude-desktop"
      : "Install Claude Desktop from https://claude.ai/download",
  });

  checks.push({
    name: "Claude Code installed",
    ok: env.claudePath !== null,
    fix: "Install with: npm install -g @anthropic-ai/claude-code",
  });

  checks.push({
    name: "Gemini CLI installed",
    ok: env.geminiPath !== null,
    fix: "Install with: npm install -g @google/gemini-cli",
  });

  checks.push({
    name: "REST server running",
    ok: env.restServerRunning,
    fix: "Start with: qunoqu server start",
  });

  checks.push({
    name: "MCP server built",
    ok: env.runMcpPath !== null,
    fix: "Run: npm run build",
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
  const env = await detectEnvironment();
  const cwd = process.cwd();
  const cursorDir = join(cwd, ".cursor");
  const configPath = join(cursorDir, "mcp.json");

  if (!env.runMcpPath) {
    console.error("Could not resolve @qunoqu/core. Run from a project that has @qunoqu/core installed (e.g. npm install @qunoqu/core). Run: npm run build");
    process.exit(1);
  }

  const projectId = detectProjectId(cwd);
  const config = {
    mcpServers: {
      qunoqu: {
        command: env.nodePath,
        args: [env.runMcpPath],
        env: { QUNOQU_PROJECT_ID: projectId },
      },
    },
  };

  await mkdir(cursorDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  console.log("Wrote", configPath);
  console.log("  QUNOQU_PROJECT_ID:", projectId);
  console.log("  Run MCP script:", env.runMcpPath);
  try {
    const written = JSON.parse(await readFile(configPath, "utf-8"));
    if (!written.mcpServers?.qunoqu) {
      throw new Error("Config written but qunoqu key missing");
    }
    console.log(chalk.green("  ✓ Config verified"));
  } catch (e) {
    console.log(chalk.red("  ✗ Config verification failed:", e instanceof Error ? e.message : String(e)));
  }
  console.log("");
  console.log("Restart Cursor for the MCP server to load.");
}

async function cmdConfigClaudeDesktop(): Promise<void> {
  const env = await detectEnvironment();
  if (!env.runMcpPath) {
    console.error("Could not resolve @qunoqu/core. Run: npm run build");
    process.exit(1);
  }
  const configPath = env.claudeDesktopConfigPath;
  if (!configPath) {
    console.error("Claude Desktop config path not detected. Install Claude Desktop from https://claude.ai/download");
    process.exit(1);
  }

  let config: Record<string, unknown> = {};
  try {
    if (existsSync(configPath)) {
      const raw = await readFile(configPath, "utf-8");
      config = JSON.parse(raw) as Record<string, unknown>;
    }
  } catch (e) {
    console.error("Failed to read existing config:", e instanceof Error ? e.message : e);
    throw e;
  }

  const projectId = detectProjectId(process.cwd());
  config.mcpServers = {
    ...(typeof config.mcpServers === "object" && config.mcpServers !== null ? config.mcpServers : {}),
    qunoqu: {
      command: env.nodePath,
      args: [env.runMcpPath],
      env: { QUNOQU_PROJECT_ID: projectId },
    },
  };

  const configDir = join(configPath, "..");
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  console.log("Wrote", configPath);
  console.log("  QUNOQU_PROJECT_ID:", projectId);
  try {
    const written = JSON.parse(await readFile(configPath, "utf-8"));
    if (!written.mcpServers?.qunoqu) {
      throw new Error("Config written but qunoqu key missing");
    }
    console.log(chalk.green("  ✓ Config verified"));
  } catch (e) {
    console.log(chalk.red("  ✗ Config verification failed:", e instanceof Error ? e.message : String(e)));
  }
  console.log("Restart Claude Desktop for the MCP server to load.");
}

async function cmdConfigClaudeCode(): Promise<void> {
  const env = await detectEnvironment();
  if (!env.runMcpPath) {
    console.error("Could not resolve @qunoqu/core. Run: npm run build");
    process.exit(1);
  }
  try {
    execSync(
      `"${env.claudePath}" mcp add qunoqu node "${env.runMcpPath}"`,
      { stdio: "pipe", env: { ...process.env } }
    );
    console.log("Added qunoqu MCP server to Claude Code.");
  } catch (e) {
    const output = e instanceof Error ? (e as { stderr?: Buffer | string }).stderr?.toString() ?? "" : "";
    const stdout = e instanceof Error ? (e as { stdout?: Buffer | string }).stdout?.toString() ?? "" : "";
    const combined = (output + stdout).toLowerCase();

    if (combined.includes("already exists")) {
      console.log("qunoqu already configured in Claude Code.");
    } else {
      throw new Error("claude mcp add failed: " + combined);
    }
  }
  console.log("Verify with: claude mcp list");
}

async function cmdConfigGemini(): Promise<void> {
  const env = await detectEnvironment();
  if (!env.runMcpPath) {
    console.error("Could not resolve @qunoqu/core. Run: npm run build");
    process.exit(1);
  }
  const projectId = detectProjectId(process.cwd());
  const geminiDir = join(homedir(), ".gemini");
  const configPath = join(geminiDir, "settings.json");

  let config: Record<string, unknown> = {};
  try {
    if (existsSync(configPath)) {
      const raw = await readFile(configPath, "utf-8");
      config = JSON.parse(raw) as Record<string, unknown>;
    }
  } catch (e) {
    console.error("Failed to read existing config:", e instanceof Error ? e.message : e);
    throw e;
  }

  config.mcpServers = {
    ...(typeof config.mcpServers === "object" && config.mcpServers !== null ? config.mcpServers : {}),
    qunoqu: {
      command: env.nodePath,
      args: [env.runMcpPath],
      env: { QUNOQU_PROJECT_ID: projectId },
    },
  };

  await mkdir(geminiDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  console.log("Wrote", configPath);
  console.log("  QUNOQU_PROJECT_ID:", projectId);
  try {
    const written = JSON.parse(await readFile(configPath, "utf-8"));
    if (!written.mcpServers?.qunoqu) {
      throw new Error("Config written but qunoqu key missing");
    }
    console.log(chalk.green("  ✓ Config verified"));
  } catch (e) {
    console.log(chalk.red("  ✗ Config verification failed:", e instanceof Error ? e.message : String(e)));
  }
  console.log("Restart Gemini CLI for changes to take effect.");
}

async function cmdConfigAll(): Promise<void> {
  const env = await detectEnvironment();

  console.log(chalk.bold("\n Detected environment\n"));
  console.log("  OS:          ", env.os);
  console.log("  Node:        ", env.nodeVersion, "at", env.nodePath);
  console.log("  Claude Code: ", env.claudePath ?? chalk.red("not found"));
  console.log("  Gemini CLI:  ", env.geminiPath ?? chalk.red("not found"));
  console.log("  run-mcp.js:  ", env.runMcpPath ?? chalk.red("not found"));
  console.log("");

  if (!env.runMcpPath) {
    console.error(chalk.red("run-mcp.js not found. Run: npm run build first"));
    process.exit(1);
  }

  const results: { name: string; ok: boolean; error?: string }[] = [];

  const run = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({
        name,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  await run("Claude Desktop", cmdConfigClaudeDesktop);
  await run("Claude Code", cmdConfigClaudeCode);
  await run("Gemini", cmdConfigGemini);
  await run("Cursor", cmdConfigCursor);

  console.log("\nSummary:");
  for (const r of results) {
    const sym = r.ok ? chalk.green("✓") : chalk.red("✗");
    console.log(`  ${sym} ${r.name}${r.ok ? "" : " — " + (r.error ?? "")}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    console.log(chalk.green("\nAll AI tools configured!"));
    console.log("Restart Cursor and Claude Desktop to activate.");
  } else {
    console.log(chalk.yellow(`\n${failed.length} tool(s) need attention. See errors above.`));
  }
}

async function cmdDebug(): Promise<void> {
  const env = await detectEnvironment();
  console.log(chalk.bold("\n Detected environment (debug)\n"));
  console.log(JSON.stringify(env, null, 2));
  console.log("");
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
    .command("debug")
    .description("Show all detected environment (paths, tools, status)")
    .action(() => cmdDebug().catch((err) => { console.error(err); process.exit(1); }));

  const configCmd = program
    .command("config")
    .description("Configure MCP for AI tools (Cursor, Claude Desktop, Claude Code, Gemini)");

  configCmd
    .command("cursor")
    .description("Write .cursor/mcp.json for Cursor IDE")
    .action(() => cmdConfigCursor().catch((err) => { console.error(err); process.exit(1); }));

  configCmd
    .command("claude-desktop")
    .description("Write Claude Desktop MCP config")
    .action(() => cmdConfigClaudeDesktop().catch((err) => { console.error(err); process.exit(1); }));

  configCmd
    .command("claude-code")
    .description("Add qunoqu MCP server to Claude Code")
    .action(() => cmdConfigClaudeCode().catch((err) => { console.error(err); process.exit(1); }));

  configCmd
    .command("gemini")
    .description("Write ~/.gemini/settings.json MCP config")
    .action(() => cmdConfigGemini().catch((err) => { console.error(err); process.exit(1); }));

  configCmd
    .command("all")
    .description("Configure all AI tools at once (Cursor, Claude Desktop, Claude Code, Gemini)")
    .action(() => cmdConfigAll().catch((err) => { console.error(err); process.exit(1); }));

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
