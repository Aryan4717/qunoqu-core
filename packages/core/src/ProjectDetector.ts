/**
 * Auto-detect a stable project ID from a directory (git remote, package.json, or dir name).
 * Always produces a UUID-like string for the same project.
 */

import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

/**
 * Turn a string into a stable UUID-like id (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).
 */
function toStableId(input: string): string {
  const hex = createHash("sha256").update(input.trim().toLowerCase()).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Get git remote origin URL from a directory, or null if not a git repo or no origin.
 */
function getGitRemoteUrl(dir: string): string | null {
  try {
    const out = execSync("git config --get remote.origin.url", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const url = (out && out.trim()) || null;
    return url || null;
  } catch {
    return null;
  }
}

/**
 * Get package.json name and version from a directory, or null if not found.
 */
function getPackageNameVersion(dir: string): { name: string; version: string } | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const raw = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { name?: string; version?: string };
    const name = typeof pkg.name === "string" ? pkg.name : "";
    const version = typeof pkg.version === "string" ? pkg.version : "0.0.0";
    if (!name) return null;
    return { name, version };
  } catch {
    return null;
  }
}

/**
 * Detect a stable project ID for the given directory. Checks in order:
 * 1. Git remote origin URL (hashed)
 * 2. package.json name + version
 * 3. Directory basename
 * Always returns a UUID-like string for the same inputs.
 */
export function detectProjectId(dir: string): string {
  const resolved = join(dir, ".");
  const absolute = resolved.startsWith("/") ? resolved : join(process.cwd(), resolved);

  const gitUrl = getGitRemoteUrl(absolute);
  if (gitUrl) return toStableId(gitUrl);

  const pkg = getPackageNameVersion(absolute);
  if (pkg) return toStableId(`${pkg.name}@${pkg.version}`);

  const basename = absolute.split("/").filter(Boolean).pop() || "project";
  return toStableId(basename);
}
