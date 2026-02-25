#!/usr/bin/env node
/**
 * @qunoqu/cli – CLI entrypoint
 */

import { hello, SHELL_INTEGRATION_SCRIPT } from "@qunoqu/core";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const QUNOQU_DIR = join(homedir(), ".qunoqu");
const SHELL_SCRIPT_PATH = join(QUNOQU_DIR, "shell-integration.sh");

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

function main(): void {
  const arg = process.argv[2];
  if (arg === "init") {
    cmdInit().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    return;
  }
  console.log(hello());
}

main();
