/**
 * API token for REST server: generate on first run, store in ~/.qunoqu/api-token.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";

const QUNOQU_DIR = join(homedir(), ".qunoqu");
const API_TOKEN_PATH = join(QUNOQU_DIR, "api-token");

export function getApiTokenPath(): string {
  return API_TOKEN_PATH;
}

/**
 * Read existing token or generate, persist, and return a new one.
 */
export function getOrCreateApiToken(): string {
  if (!existsSync(QUNOQU_DIR)) {
    mkdirSync(QUNOQU_DIR, { recursive: true });
  }
  if (existsSync(API_TOKEN_PATH)) {
    return readFileSync(API_TOKEN_PATH, "utf-8").trim();
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(API_TOKEN_PATH, token, "utf-8");
  return token;
}

/**
 * Read token without creating. Returns null if missing.
 */
export function readApiToken(): string | null {
  if (!existsSync(API_TOKEN_PATH)) return null;
  try {
    return readFileSync(API_TOKEN_PATH, "utf-8").trim() || null;
  } catch {
    return null;
  }
}
