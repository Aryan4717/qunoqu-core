#!/usr/bin/env node
/**
 * Standalone entry to run the REST API server (e.g. node dist/run-server.js).
 * CLI "qunoqu server start" can use this or call startServer() directly.
 */

import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { startServer, DEFAULT_API_PID_PATH } from "./server.js";

const PID_FILE = DEFAULT_API_PID_PATH;

startServer()
  .then(({ server, port }) => {
    writeFileSync(PID_FILE, String(process.pid), "utf-8");
    console.log(`Qunoqu REST API listening on http://localhost:${port}`);
    console.log(`Token file: ~/.qunoqu/api-token`);
    server.on("close", () => {
      try {
        unlinkSync(PID_FILE);
      } catch {
        // ignore
      }
    });
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
