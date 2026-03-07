#!/usr/bin/env node
/**
 * Entrypoint for the Qunoqu daemon. Spawned by CLI as a detached child process.
 * Reads projectRoot and projectId from env or .qunoqu-config.json.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { QunoqDaemon } from "./QunoqDaemon.js";
import { detectProjectId } from "./ProjectDetector.js";

const QUNOQU_DIR = join(homedir(), ".qunoqu");

// Write PID immediately so CLI can confirm daemon started after spawn
mkdirSync(QUNOQU_DIR, { recursive: true });
writeFileSync(join(QUNOQU_DIR, "daemon.pid"), String(process.pid));

function getProjectRoot(): string {
  return process.env.QUNOQU_PROJECT_ROOT || process.cwd();
}

function getProjectId(projectRoot: string): string | null {
  if (process.env.QUNOQU_PROJECT_ID) {
    return process.env.QUNOQU_PROJECT_ID;
  }
  const configPath = join(projectRoot, ".qunoqu-config.json");
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as { projectId?: string };
    return config.projectId ?? null;
  } catch {
    return null;
  }
}

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

async function main(): Promise<void> {
  const projectRoot = getProjectRoot();
  let projectId = getProjectId(projectRoot);
  if (!projectId) {
    projectId = detectProjectId(projectRoot);
  }
  if (!projectId) {
    console.error("qunoqu daemon: projectId not found. Set QUNOQU_PROJECT_ID or run 'qunoqu init' in the project.");
    process.exit(1);
  }

  const daemon = new QunoqDaemon({
    projectRoot,
    projectId,
  });

  const shutdown = async (): Promise<void> => {
    if (heartbeatInterval !== null) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    await daemon.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown().catch(() => process.exit(1));
  });
  process.on("SIGTERM", () => {
    shutdown().catch(() => process.exit(1));
  });
  process.on("uncaughtException", (err) => {
    console.error("qunoqu daemon uncaughtException:", err);
    daemon.stop().finally(() => process.exit(1));
  });

  // Keep event loop alive so process stays running
  heartbeatInterval = setInterval(() => {}, 10000);

  await daemon.start();
}

main().catch((err) => {
  console.error("qunoqu daemon failed to start:", err);
  process.exit(1);
});
