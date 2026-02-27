/**
 * PrivacyFilter – runs on every ContextItem BEFORE storage.
 * .qunoqu-ignore (gitignore-style), default ignores, PII/secret scrubber, content length limit.
 * Logs what was filtered and why to ~/.qunoqu/privacy.log, never the actual sensitive content.
 */

import ignoreModule from "ignore";
import type { Ignore } from "ignore";
const ignore = (ignoreModule as unknown) as (opts?: { ignorecase?: boolean }) => Ignore;
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "fs";
import { join, relative, dirname } from "path";
import { homedir } from "os";
import type { ContextItem } from "./types.js";

const QUNOQU_DIR = join(homedir(), ".qunoqu");
const PRIVACY_LOG_PATH = join(QUNOQU_DIR, "privacy.log");
const MAX_CONTENT_LENGTH = 2000;

/** Default ignore patterns (never capture .env, credentials, etc.) */
const DEFAULT_IGNORE_PATTERNS = [
  ".env",
  ".env.*",
  "*.key",
  "*.pem",
  "*secret*",
  "*credential*",
  "*password*",
  ".git/*",
  "node_modules/*",
  "dist/*",
  "build/*",
];

/** Reasons we log (never include the actual secret). */
type FilterReason =
  | "path_ignored"
  | "api_key_detected"
  | "jwt_detected"
  | "private_key_detected"
  | "password_in_content_detected"
  | "credit_card_detected"
  | "content_truncated";

/** PII/secret patterns – replace match with [REDACTED]. Order matters: more specific before generic. */
const PII_PATTERNS: Array<{ reason: FilterReason; regex: RegExp; replaceValue?: boolean }> = [
  { reason: "jwt_detected", regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g },
  { reason: "private_key_detected", regex: /-----BEGIN (?:RSA |EC |)?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |)?PRIVATE KEY-----/g },
  { reason: "password_in_content_detected", regex: /((?:password|passwd|pwd)\s*=\s*["'])([^"']+)(["'])/gi, replaceValue: true },
  { reason: "credit_card_detected", regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  { reason: "api_key_detected", regex: /\b(?:api[_-]?key|apikey|secret)[\s:=]+["']?[A-Za-z0-9_-]{20,}["']?/gi },
  { reason: "api_key_detected", regex: /\b[A-Za-z0-9_-]{32,}\b/g },
];

export interface PrivacyFilterOptions {
  /** Project root for resolving .qunoqu-ignore and relative paths */
  projectRoot?: string;
  /** Path to .qunoqu-ignore file (default: projectRoot/.qunoqu-ignore) */
  qunoquIgnorePath?: string;
  /** Custom ignore patterns appended to defaults */
  extraIgnorePatterns?: string[];
  /** Max content length (default 2000) */
  maxContentLength?: number;
  /** Log file path (default ~/.qunoqu/privacy.log) */
  logPath?: string;
}

function logFilter(reason: FilterReason, detail: string, logPath: string = PRIVACY_LOG_PATH): void {
  try {
    const dir = dirname(logPath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = `${new Date().toISOString()}\t${reason}\t${detail}\n`;
    appendFileSync(logPath, line, "utf-8");
  } catch {
    // best-effort
  }
}

function buildIgnore(projectRoot: string | undefined, qunoquIgnorePath: string | undefined, extra: string[] = []): Ignore | null {
  const ig = ignore();
  ig.add(DEFAULT_IGNORE_PATTERNS);
  ig.add(extra);
  if (projectRoot && qunoquIgnorePath && existsSync(qunoquIgnorePath)) {
    try {
      const content = readFileSync(qunoquIgnorePath, "utf-8");
      ig.add(content);
    } catch {
      // skip if unreadable
    }
  }
  return ig;
}

/**
 * Scrub PII/secrets from content. Returns { content, reasons }.
 * Caller logs reasons without the actual content.
 */
function scrubContent(content: string): { content: string; reasons: FilterReason[] } {
  let out = content;
  const reasons: FilterReason[] = [];
  for (const { reason, regex, replaceValue } of PII_PATTERNS) {
    const before = out;
    if (replaceValue) {
      out = out.replace(regex, (_, prefix: string, _value: string, suffix: string) => {
        if (!reasons.includes(reason)) reasons.push(reason);
        return `${prefix}[REDACTED]${suffix}`;
      });
    } else {
      out = out.replace(regex, () => {
        if (!reasons.includes(reason)) reasons.push(reason);
        return "[REDACTED]";
      });
    }
    if (out !== before && !reasons.includes(reason)) reasons.push(reason);
  }
  return { content: out, reasons };
}

export class PrivacyFilter {
  private ig: Ignore | null;
  private projectRoot: string | undefined;
  private maxContentLength: number;
  private logPath: string;

  constructor(options: PrivacyFilterOptions = {}) {
    this.projectRoot = options.projectRoot;
    const qunoquIgnorePath =
      options.qunoquIgnorePath ??
      (this.projectRoot ? join(this.projectRoot, ".qunoqu-ignore") : undefined);
    this.ig = buildIgnore(this.projectRoot, qunoquIgnorePath, options.extraIgnorePatterns);
    this.maxContentLength = options.maxContentLength ?? MAX_CONTENT_LENGTH;
    this.logPath = options.logPath ?? PRIVACY_LOG_PATH;
  }

  /**
   * Filter a single context item. Returns the cleaned item or null if it should be dropped entirely.
   */
  filter(item: ContextItem): ContextItem | null {
    const filePath = item.filePath ?? "";

    if (this.ig && this.projectRoot && filePath) {
      const relativePath = relative(this.projectRoot, join(this.projectRoot, filePath)).replace(/\\/g, "/");
      if (relativePath && !relativePath.startsWith("..") && this.ig.ignores(relativePath)) {
        logFilter("path_ignored", `file_path=${relativePath}`, this.logPath);
        return null;
      }
    }

    let content = item.content;
    const { content: scrubbed, reasons: scrubReasons } = scrubContent(content);
    content = scrubbed;
    for (const r of scrubReasons) {
      logFilter(r, `file_path=${filePath || "(no path)"}`, this.logPath);
    }

    if (content.length > this.maxContentLength) {
      logFilter("content_truncated", `file_path=${filePath || "(no path)"} length=${content.length}`, this.logPath);
      content = content.slice(0, this.maxContentLength);
    }

    return { ...item, content };
  }
}

const defaultFilter = new PrivacyFilter();

/**
 * Filter a context item before storage. Returns the cleaned item or null if the item should be dropped.
 * Use this at the boundary before calling MetadataStore.insertContextItem or VectorStore.addContext.
 */
export function filterContextItem(
  item: ContextItem,
  options?: PrivacyFilterOptions
): ContextItem | null {
  const filter = options ? new PrivacyFilter(options) : defaultFilter;
  return filter.filter(item);
}
