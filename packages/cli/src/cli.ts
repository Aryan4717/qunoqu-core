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
import { join, dirname, basename } from "path";
import { homedir } from "os";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";

const QUNOQU_DIR = join(homedir(), ".qunoqu");
const SHELL_SCRIPT_PATH = join(QUNOQU_DIR, "shell-integration.sh");
const CONFIG_FILENAME = ".qunoqu-config.json";
const DAEMON_PID_PATH = join(QUNOQU_DIR, "daemon.pid");
const DAEMON_LOG_PATH = join(QUNOQU_DIR, "daemon.log");
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

async function getProjectId(root: string): Promise<string> {
  const configPath = join(root, CONFIG_FILENAME);
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(await readFile(configPath, "utf-8"));
      if (config.projectId) return config.projectId;
    }
  } catch {
    /* fall through */
  }
  return detectProjectId(root);
}

function getDaemonPid(): number | null {
  if (!existsSync(DAEMON_PID_PATH)) return null;
  try {
    const raw = readFileSync(DAEMON_PID_PATH, "utf-8").trim();
    const pid = parseInt(raw, 10);
    if (Number.isNaN(pid)) return null;
    process.kill(pid, 0);
    return pid;
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
    await cmdInitAiContext();
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
    "",
    chalk.green("Run 'qunoqu daemon start' to begin capturing automatically."),
  ].join("\n");

  console.log(boxen(msg, { padding: 1, borderColor: "green" }));
}

async function cmdInitAiContext(): Promise<void> {
  const root = getProjectRoot();

  const cursorrules = `# Qunoqu Memory — 4 MCP Tools, Always Automatic

This project uses Qunoqu memory. You have 4 MCP tools available.
NEVER ask the user to call any tool manually.
NEVER use tool names in conversation.
Handle everything automatically and silently.

---

## Tool 1 — recall_context
PURPOSE: Search project memory by keyword or natural language.
Searches both SQLite (keyword) and ChromaDB (semantic) simultaneously.

WHEN TO USE AUTOMATICALLY:
Always call recall_context first before answering when user asks:
- Why something was built or chosen a certain way
- How something works in this project
- What decisions were made about anything
- Architecture, design, technology choices
- Past problems, bugs, or solutions
- Performance, scaling, infrastructure decisions
- Any question containing "why", "how", "what was", "what did we"
- Any question about this codebase specifically

HOW TO USE:
- Extract the key topic from the user question as the query
- Use specific keywords: "WebSockets", "authentication", "database"
- Use topK=10 for broad questions, topK=5 for specific ones
- If first search returns nothing, try broader keywords

EXAMPLES:
User: "why did we choose WebSockets?"
→ call recall_context query="WebSockets" topK=5

User: "how is authentication structured?"
→ call recall_context query="authentication auth login" topK=5

User: "what performance decisions did we make?"
→ call recall_context query="performance latency speed" topK=10

User: "why is the DB structured this way?"
→ call recall_context query="database schema structure" topK=5

User: "what problems did we solve in Sprint 2?"
→ call recall_context query="Sprint 2 problems solutions" topK=10

---

## Tool 2 — save_decision
PURPOSE: Save an important technical decision permanently to memory.
Stores in both SQLite and KnowledgeGraph simultaneously.

WHEN TO USE AUTOMATICALLY (without asking):
Call save_decision silently whenever user says:
- "we decided to..."
- "we chose X because..."
- "we are going with X"
- "let's use X instead of Y"
- "we will use X"
- "I decided..."
- "going with X because..."
- "X was chosen because..."
- "we picked X over Y because..."
- "the reason we use X is..."
- any sentence that explains WHY a technical choice was made

HOW TO EXTRACT:
- title: 5-10 words, starts with a verb ("Use X", "Choose X over Y", "Switch to X")
- rationale: the complete reason given, keep all details

AFTER SAVING:
Add this line at end of response: "💾 Saved to Qunoqu memory"
Do NOT interrupt conversation or ask permission first.

EXAMPLES:
User: "we are going with Postgres because Redis doesn't persist well"
→ call save_decision:
  title: "Use Postgres over Redis"
  rationale: "Redis doesn't persist data well enough for our use case"
→ add: "💾 Saved to Qunoqu memory"

User: "let's use WebSockets instead of polling — polling adds 500ms"
→ call save_decision:
  title: "Use WebSockets over polling"
  rationale: "Polling adds 500ms latency. WebSockets stream instantly."
→ add: "💾 Saved to Qunoqu memory"

User: "we decided TypeScript strict mode — catches bugs at compile time"
→ call save_decision:
  title: "Use TypeScript strict mode"
  rationale: "Catches bugs at compile time, reduces runtime errors"
→ add: "💾 Saved to Qunoqu memory"

OFFER TO SAVE (ask once, save immediately if yes):
After any important technical discussion where a decision was reached
but trigger phrases were not used, add at end of response:
"Want me to save this decision to Qunoqu memory? (yes/no)"
If user says yes → call save_decision immediately, no more questions.

---

## Tool 3 — get_project_summary
PURPOSE: Returns last 10 context items, all decisions, knowledge 
graph nodes, total stats for a project.

WHEN TO USE AUTOMATICALLY:
Call get_project_summary when user says:
- "give me an overview of this project"
- "what do we have in memory?"
- "summarize the project"
- "what decisions have we made?"
- "show me everything stored"
- "what has been captured?"
- "project summary"
- "what does qunoqu know about this project?"

EXAMPLES:
User: "give me a project overview"
→ call get_project_summary then summarize clearly

User: "what decisions have we made so far?"
→ call get_project_summary then list just the decisions section

User: "what does qunoqu know about this project?"
→ call get_project_summary then show all sections

---

## Tool 4 — list_projects
PURPOSE: Lists all projects in Qunoqu memory with context counts 
and last active timestamps.

WHEN TO USE AUTOMATICALLY:
Call list_projects when user says:
- "what projects are in memory?"
- "list all projects"
- "what projects does qunoqu know about?"
- "show me all projects"
- "which projects are tracked?"
- "how many projects does qunoqu have?"

EXAMPLES:
User: "what projects are in qunoqu?"
→ call list_projects then show results

User: "how many projects are being tracked?"
→ call list_projects then count and summarize

---

## Golden Rules

1. NEVER use tool names in conversation ("recall_context", 
   "save_decision" etc). Just use them silently.
2. NEVER ask permission to recall — just do it.
3. NEVER ask permission to save when trigger phrases are used — 
   just save silently and add 💾.
4. ALWAYS try recall_context before answering project questions.
5. If recall returns nothing useful, say "Nothing found in project 
   memory for this topic" then answer from code context.
6. Chain tools when needed: recall first, if empty try 
   get_project_summary for broader context.`;

  const claudeMd = `# Qunoqu Project Memory — 4 MCP Tools

This project uses Qunoqu memory. You have 4 MCP tools.
Never ask the user to call tools manually. Handle automatically.

## Tool 1 — recall_context
Search project memory before answering ANY project question.

AUTO-TRIGGER when user asks about:
- Why something was built or chosen
- How something works in this codebase
- What decisions were made
- Architecture, design, technology choices
- Past problems or solutions
- Any "why", "how", "what was", "what did we" question

USAGE: Extract keywords from question, call recall_context.
If nothing found, try broader keywords before giving up.

Examples:
- "why WebSockets?" → recall_context("WebSockets latency")
- "how does auth work?" → recall_context("authentication auth")
- "what DB did we pick?" → recall_context("database")
- "past performance issues?" → recall_context("performance latency")

## Tool 2 — save_decision
Save decisions automatically without asking.

AUTO-TRIGGER on phrases:
"we decided", "we chose X because", "we are going with",
"let's use X instead of", "we will use", "going with X because",
"the reason we use X", "we picked X over Y because"

Extract: title (5-10 words), rationale (full reason)
After saving add: "💾 Saved to Qunoqu memory"

Examples:
- "we chose SQLite because zero infrastructure" 
  → save title="Use SQLite" rationale="Zero infrastructure needed"
  → "💾 Saved to Qunoqu memory"

- "going with Express over Fastify — team knows it better"
  → save title="Use Express over Fastify"
  → rationale="Team is more familiar with Express"
  → "💾 Saved to Qunoqu memory"

OFFER TO SAVE after important technical discussions:
"Want me to save this to Qunoqu memory?"
Save immediately if yes.

## Tool 3 — get_project_summary
AUTO-TRIGGER when user asks:
"project overview", "what's in memory", "summarize project",
"what decisions have we made", "what has been captured",
"what does qunoqu know"

## Tool 4 — list_projects
AUTO-TRIGGER when user asks:
"what projects are in qunoqu", "list projects",
"how many projects tracked", "show all projects"

## Golden Rules
1. Never use tool names in conversation
2. Never ask permission to recall — just do it
3. Never ask permission to save on trigger phrases — save silently
4. Always recall before answering project questions
5. Chain tools: recall first → if empty → get_project_summary`;

  const geminiMd = `# Qunoqu Project Memory — 4 MCP Tools

This project uses Qunoqu memory. You have 4 MCP tools.
Always approve and use them automatically. Never ask user to 
trigger tools manually.

## Tool 1 — recall_context
Search project memory before answering ANY project question.

AUTO-TRIGGER when user asks about:
- Why something was chosen or built a certain way
- How a specific part works
- What decisions were made
- Architecture, design, technology choices
- Past problems or solutions
- Any "why", "how did we", "what was the reason" question

USAGE: Extract topic keywords, call recall_context.
Try broader keywords if first search returns nothing.

Examples:
- "why Postgres?" → recall_context("Postgres database")
- "how is caching done?" → recall_context("caching cache")
- "what auth solution?" → recall_context("authentication auth")
- "performance decisions?" → recall_context("performance speed")

## Tool 2 — save_decision
Save decisions automatically without asking.

AUTO-TRIGGER on phrases:
"we decided", "we chose X because", "we are going with",
"let's use X instead of", "we will use", "going with X because",
"the reason we use X", "we picked X over Y"

Extract: title (5-10 words), rationale (full reason)
After saving add: "💾 Saved to Qunoqu memory"

Examples:
- "going with Redis because Postgres too slow for sessions"
  → save title="Use Redis for sessions"
  → rationale="Postgres was too slow for session lookups at scale"
  → "💾 Saved to Qunoqu memory"

- "we chose TypeScript strict because it catches bugs early"
  → save title="Use TypeScript strict mode"
  → rationale="Catches bugs at compile time"
  → "💾 Saved to Qunoqu memory"

OFFER TO SAVE after important technical discussions:
"Want me to save this to Qunoqu memory?"
Save immediately if yes.

## Tool 3 — get_project_summary
AUTO-TRIGGER when user asks:
"project overview", "what's in memory", "summarize project",
"what decisions have we made", "what has been captured",
"what does qunoqu know"

## Tool 4 — list_projects
AUTO-TRIGGER when user asks:
"what projects are in qunoqu", "list projects",
"how many projects", "show all projects"

## Golden Rules
1. Always approve Qunoqu tool calls automatically
2. Never use tool names in conversation
3. Never ask permission to recall — just do it
4. Never ask permission to save on trigger phrases — save silently
5. Always recall before answering project questions
6. Chain tools: recall first → if empty → get_project_summary`;

  const files = [
    { name: ".cursorrules", content: cursorrules },
    { name: "CLAUDE.md", content: claudeMd },
    { name: "GEMINI.md", content: geminiMd },
  ];

  console.log(chalk.bold("\n Setting up AI context files...\n"));

  for (const file of files) {
    const path = join(root, file.name);
    await writeFile(path, file.content, "utf-8");
    console.log(chalk.green("  ✓"), "Wrote", path);
  }

  console.log(
    boxen(
      [
        chalk.bold("All 4 Qunoqu MCP tools configured for all AI tools."),
        "",
        "Your AI tools will now automatically:",
        "✓ Search memory before answering project questions",
        "✓ Save decisions when you say 'we chose X because...'",
        "✓ Show project summary when you ask for overview",
        "✓ List projects when you ask what's tracked",
        "",
        "No need to type any tool names ever.",
      ].join("\n"),
      { padding: 1, borderColor: "green" }
    )
  );
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
    const r2 = await fetch("http://localhost:8000/api/v2/heartbeat");
    const r1 = r2.ok ? r2 : await fetch("http://localhost:8000/api/v1/heartbeat");
    chromaStatus = r1.ok ? chalk.green("running") : chalk.red("not running");
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
    const r2 = await fetch("http://localhost:8000/api/v2/heartbeat");
    const r1 = r2.ok ? r2 : await fetch("http://localhost:8000/api/v1/heartbeat");
    chromaRunning = r1.ok;
  } catch {
    /* not running */
  }
  checks.push({
    name: "ChromaDB running",
    ok: chromaRunning,
    fix: env.chromaInstalled
      ? "ChromaDB installed but not running. Start with: npx chroma run --path ~/.qunoqu/chroma (from repo root)"
      : "From repo root: npx chroma run --path ~/.qunoqu/chroma (or: pip install chromadb && chroma run --path ~/.qunoqu/chroma)",
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

/** Resolve path to @qunoqu/core dist/run-daemon.js (same pattern as run-mcp). */
function resolveRunDaemonPath(cwd: string): string {
  const cliDir = dirname(fileURLToPath(import.meta.url));
  const siblingCoreRunDaemon = join(cliDir, "..", "..", "core", "dist", "run-daemon.js");
  if (existsSync(siblingCoreRunDaemon)) return siblingCoreRunDaemon;

  const require = createRequire(import.meta.url);
  const searchPaths = [cwd, join(cliDir, "..", "..", ".."), join(cliDir, "..")];
  for (const p of searchPaths) {
    try {
      const corePkgPath = require.resolve("@qunoqu/core/package.json", { paths: [p] });
      return join(dirname(corePkgPath), "dist", "run-daemon.js");
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

  const projectId = await getProjectId(cwd);
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

  const projectId = await getProjectId(process.cwd());
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
  const projectId = await getProjectId(process.cwd());
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

async function cmdDaemonStart(): Promise<void> {
  const pid = getDaemonPid();
  if (pid !== null) {
    console.log(`Daemon already running (PID: ${pid})`);
    return;
  }
  const projectRoot = getProjectRoot();
  const projectId = await getProjectId(projectRoot);
  let runDaemonPath: string;
  try {
    runDaemonPath = resolveRunDaemonPath(process.cwd());
  } catch (e) {
    console.error(chalk.red(e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }
  const nodePath = process.execPath;
  spawn(nodePath, [runDaemonPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      QUNOQU_PROJECT_ROOT: projectRoot,
      QUNOQU_PROJECT_ID: projectId,
    },
  }).unref();
  await new Promise((r) => setTimeout(r, 1000));
  const newPid = getDaemonPid();
  if (newPid === null) {
    console.error(chalk.red("Daemon may have failed to start. Check logs: ") + DAEMON_LOG_PATH);
    process.exit(1);
  }
  console.log(chalk.green("Qunoqu daemon started (PID: " + newPid + ")"));
  console.log("  Watching:", projectRoot);
  console.log("  REST server: http://localhost:7384");
  console.log("  Logs:", DAEMON_LOG_PATH);
}

async function cmdDaemonStop(): Promise<void> {
  const pid = getDaemonPid();
  if (pid === null) {
    console.log("Daemon is not running");
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    console.log("Daemon is not running");
    return;
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (getDaemonPid() === null) {
      console.log(chalk.green("Daemon stopped"));
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
  console.log(chalk.green("Daemon stopped"));
}

async function cmdDaemonStatus(): Promise<void> {
  const pid = getDaemonPid();
  if (pid === null) {
    console.log("Daemon is not running");
    console.log("Run: qunoqu daemon start");
    return;
  }
  const projectRoot = getProjectRoot();
  const projectId = await getProjectId(projectRoot);
  const store = new MetadataStore();
  const projects = store.listProjects();
  const project = projects.find((p) => p.id === projectId || p.root_path === projectRoot);
  const projectName = project?.name ?? basename(projectRoot);
  const items = store.getByProject(projectId);
  store.close();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const capturedToday = items.filter((i) => i.created_at >= startOfToday.getTime()).length;
  let restStatus = "not running";
  try {
    const r = await fetch("http://localhost:7384/health");
    restStatus = r.ok ? "running" : "not running";
  } catch {
    // ignore
  }
  const pidPath = DAEMON_PID_PATH;
  let startedAt: number | null = null;
  if (existsSync(pidPath)) {
    try {
      const raw = readFileSync(pidPath, "utf-8");
      const n = parseInt(raw.trim(), 10);
      if (!Number.isNaN(n) && n === pid) {
        startedAt = Date.now(); // we don't persist startedAt in pid file; show "running"
      }
    } catch {
      // ignore
    }
  }
  console.log(chalk.bold("Daemon running (PID: " + pid + ")"));
  console.log("  Project:", projectName);
  console.log("  Watching:", projectRoot);
  console.log("  REST server:", restStatus);
  console.log("  Total captured:", items.length, "items");
  console.log("  Captured today:", capturedToday, "items");
  console.log("  Started: running");
  console.log("  Logs:", DAEMON_LOG_PATH);
}

function cmdDaemonLogs(): void {
  if (!existsSync(DAEMON_LOG_PATH)) {
    console.log("No logs yet. Start daemon first.");
    return;
  }
  const content = readFileSync(DAEMON_LOG_PATH, "utf-8");
  const lines = content.trim().split("\n");
  const last = lines.slice(-30);
  for (const line of last) {
    const tab = line.indexOf("\t");
    const ts = tab >= 0 ? line.slice(0, tab) : "";
    const rest = tab >= 0 ? line.slice(tab + 1) : line;
    if (rest.startsWith("Stored:")) {
      console.log(chalk.gray(ts) + "\t" + chalk.green(rest));
    } else if (rest.startsWith("Filtered:")) {
      console.log(chalk.gray(ts) + "\t" + chalk.yellow(rest));
    } else if (rest.includes("ERROR")) {
      console.log(chalk.gray(ts) + "\t" + chalk.red(rest));
    } else {
      console.log(chalk.gray(ts) + "\t" + rest);
    }
  }
}

async function cmdDaemonRestart(): Promise<void> {
  await cmdDaemonStop();
  await new Promise((r) => setTimeout(r, 500));
  await cmdDaemonStart();
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
    .command("init-ai-context")
    .description("Create .cursorrules, CLAUDE.md, GEMINI.md so AI tools automatically use Qunoqu memory")
    .action(() => cmdInitAiContext().catch((err) => { console.error(err); process.exit(1); }));

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

  const daemonCmd = program
    .command("daemon")
    .description("Manage the Qunoqu background daemon");

  daemonCmd
    .command("start")
    .description("Start background capture daemon")
    .action(() => cmdDaemonStart().catch((err) => { console.error(err); process.exit(1); }));

  daemonCmd
    .command("stop")
    .description("Stop background capture daemon")
    .action(() => cmdDaemonStop().catch((err) => { console.error(err); process.exit(1); }));

  daemonCmd
    .command("status")
    .description("Show daemon status and capture stats")
    .action(() => cmdDaemonStatus().catch((err) => { console.error(err); process.exit(1); }));

  daemonCmd
    .command("logs")
    .description("Show recent capture logs")
    .action(() => {
      try {
        cmdDaemonLogs();
      } catch (err) {
        console.error(err);
        process.exit(1);
      }
    });

  daemonCmd
    .command("restart")
    .description("Restart the daemon")
    .action(() => cmdDaemonRestart().catch((err) => { console.error(err); process.exit(1); }));

  program.parse(process.argv);

  if (process.argv.length <= 2) {
    program.outputHelp();
  }
}

main();
