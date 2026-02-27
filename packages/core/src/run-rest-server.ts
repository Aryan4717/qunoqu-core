#!/usr/bin/env node
/**
 * Entrypoint for the Qunoqu REST API server.
 * Run: node packages/core/dist/run-rest-server.js
 * Or via CLI: qunoqu server start
 */

import { createRestApiServer, getOrCreateApiTokenForServer, getApiTokenPath } from "./RestApiServer.js";

const port = parseInt(process.env.QUNOQU_API_PORT ?? "7384", 10);
const server = createRestApiServer({ port });

server.server.on("listening", () => {
  const token = getOrCreateApiTokenForServer();
  const tokenPath = getApiTokenPath();
  process.stdout.write(
    `Qunoqu REST API listening on http://localhost:${port}\n` +
      `Token file: ${tokenPath}\n` +
      `Use: Authorization: Bearer <token from file>\n`
  );
});

server.server.on("error", (err: Error) => {
  console.error("Qunoqu REST API failed to start:", err.message);
  process.exit(1);
});

function shutdown() {
  server.close().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
