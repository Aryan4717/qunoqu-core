/**
 * PrivacyFilter – runs on every ContextItem before storage.
 * .qunoqu-ignore (gitignore syntax), default credential ignores, PII scrubber, length limit, logging.
 */

import ignoreModule from "ignore";
import type { Ignore } from "ignore";

const ignore = typeof ignoreModule === "function" ? ignoreModule : (ignoreModule as { default: () => Ignore }).default;
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "fs";
import { join, relative } from "path";
import { homedir } from "os";
import type { ContextItem } from "./types.js";

const QUNOQU_DIR = join(homedir(), ".qunoqu");
const PRIVACY_LOG_PATH = join(QUNOQU_DIR, "privacy.log");
const MAX_CONTENT_CHARS = 2000;
const REDACTED = "[REDACTED]";

/** Default path patterns to ignore (never capture). */
export const DEFAULT_IGNORE_PATTERNS = [
  ".env",
  ".env.*",
  "*.key",
  "*.pem",
  "*secret*",
  "*credential*",
  "*password*",
  ".git/",
  "node_modules/",
  "node_modules/*",
  "dist/",
  "dist/*",
  "build/",
  "build/*",
];

/** Reasons we log (without sensitive content). */
export type PrivacyLogReason =
  | "path_ignored"
  | "content_redacted"
  | "content_truncated"
  | "item_dropped";

function ensureLogDir(): void {
  if (!existsSync(QUNOQU_DIR)) {
    mkdirSync(QUNOQU_DIR, { recursive: true });
  }
}

function logPrivacy(reason: PrivacyLogReason, detail: string): void {
  try {
    ensureLogDir();
    const line = `${new Date().toISOString()}\t${reason}\t${detail}\n`;
    appendFileSync(PRIVACY_LOG_PATH, line, "utf-8");
  } catch {
    // best-effort only
  }
}

/**
 * Scans text for PII/secret patterns and replaces with [REDACTED].
 * Does not log the actual content.
 */
function scrubContent(content: string): { text: string; changed: boolean } {
  let text = content;
  let changed = false;

  // JWT (eyJ...)
  const jwtRe = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
  if (jwtRe.test(text)) {
    text = text.replace(jwtRe, REDACTED);
    changed = true;
  }

  // Private key block (BEGIN PRIVATE KEY ... END PRIVATE KEY)
  const pemRe = /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/gi;
  if (pemRe.test(text)) {
    text = text.replace(pemRe, REDACTED);
    changed = true;
  }

  // password="..." or password='...' or password: "..."
  const passwordRe = /password\s*[=:]\s*["'][^"']*["']/gi;
  if (passwordRe.test(text)) {
    text = text.replace(passwordRe, `password=[${REDACTED}]`);
    changed = true;
  }

  // API key / token style: key=... or api_key="..." (20+ alphanumeric)
  const keyValueRe = /(?:api[_-]?key|token|secret|auth)\s*[=:]\s*["']?[A-Za-z0-9_-]{20,}/gi;
  if (keyValueRe.test(text)) {
    text = text.replace(keyValueRe, (m) => m.replace(/[A-Za-z0-9_-]{20,}$/i, REDACTED));
    changed = true;
  }

  // Standalone long alphanumeric (32+ chars) – likely key/token
  const longTokenRe = /\b[A-Za-z0-9_-]{32,}\b/g;
  const beforeStandalone = text;
  text = text.replace(longTokenRe, REDACTED);
  if (text !== beforeStandalone) changed = true;

  // Credit card (4 groups of 4 digits, optional space/dash)
  const ccRe = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
  if (ccRe.test(text)) {
    text = text.replace(ccRe, REDACTED);
    changed = true;
  }

  return { text, changed };
}

export interface PrivacyFilterOptions {
  /** Project root to resolve .qunoqu-ignore and relative paths. */
  projectRoot?: string;
  /** Override path to .qunoqu-ignore (default: projectRoot/.qunoqu-ignore). */
  ignoreFilePath?: string;
  /** Extra ignore patterns (merged with defaults and .qunoqu-ignore). */
  extraIgnore?: string[];
  /** Max content length (default 2000). */
  maxContentChars?: number;
}

export class PrivacyFilter {
  private projectRoot: string;
  private ig: Ignore;
  private maxContentChars: number;

  constructor(options: PrivacyFilterOptions = {}) {
    this.projectRoot = options.projectRoot ?? "";
    this.maxContentChars = options.maxContentChars ?? MAX_CONTENT_CHARS;
    this.ig = (ignore as () => Ignore)().add(DEFAULT_IGNORE_PATTERNS);
    if (options.extraIgnore?.length) {
      this.ig.add(options.extraIgnore);
    }
    this.loadQunoquIgnore(options.ignoreFilePath);
  }

  private loadQunoquIgnore(overridePath?: string): void {
    const path = overridePath ?? (this.projectRoot ? join(this.projectRoot, ".qunoqu-ignore") : "");
    if (!path || !existsSync(path)) return;
    try {
      const content = readFileSync(path, "utf-8");
      this.ig.add(content);
    } catch {
      // best-effort
    }
  }

  /**
   * Returns true if the path should be ignored (skip capture entirely).
   * Path should be relative to project root or absolute (will be relativized when projectRoot is set).
   */
  shouldIgnorePath(filePath: string): boolean {
    if (!filePath.trim()) return false;
    let relPath: string;
    if (this.projectRoot && (filePath.startsWith(this.projectRoot) || filePath.startsWith("/"))) {
      try {
        relPath = relative(this.projectRoot, filePath);
      } catch {
        relPath = filePath.replace(/^\.\//, "");
      }
    } else {
      relPath = filePath.replace(/^\.\//, "");
    }
    if (relPath.startsWith("..") || relPath === "" || relPath === ".") return false;
    const normalized = relPath.split("\\").join("/");
    return this.ig.ignores(normalized) || this.ig.ignores(normalized + "/");
  }

  /**
   * Filter one context item: apply path ignore, scrub, truncate, log.
   * Returns the cleaned item or null if the whole item should be dropped.
   */
  filter(item: ContextItem): ContextItem | null {
    if (item.filePath && this.shouldIgnorePath(item.filePath)) {
      logPrivacy("path_ignored", `filePath=${item.filePath}`);
      return null;
    }

    let content = item.content;
    const { text: scrubbed, changed: redacted } = scrubContent(content);
    if (redacted) {
      logPrivacy("content_redacted", `filePath=${item.filePath || "(terminal)"} length=${content.length}`);
      content = scrubbed;
    }

    if (content.length > this.maxContentChars) {
      logPrivacy("content_truncated", `filePath=${item.filePath || "(terminal)"} from=${content.length} to=${this.maxContentChars}`);
      content = content.slice(0, this.maxContentChars);
    }

    return {
      ...item,
      content,
    };
  }
}

/** Path to privacy log (for tests or tooling). */
export function getPrivacyLogPath(): string {
  return PRIVACY_LOG_PATH;
}

/**
 * Filter a single context item. Uses a default PrivacyFilter when projectRoot is provided.
 * Returns the cleaned item or null if the item should be dropped.
 */
export function filterContextItem(item: ContextItem, projectRoot?: string): ContextItem | null {
  const filter = new PrivacyFilter({ projectRoot });
  return filter.filter(item);
}
