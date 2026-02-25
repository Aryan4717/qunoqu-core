/**
 * Extract relevant context from source file content.
 * Returns items for: function names, class names, TODO/FIXME, imports, architecture-decision comments.
 */

import type { ContextItem, ContextItemType } from "./types.js";

const ADR_PATTERN = /\b(because|decided|chose|reason)\b/i;
const LINE_COMMENT = /\/\/[^\n]*/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;

function extractCommentsContaining(
  content: string,
  filePath: string,
  projectId: string,
  type: ContextItemType,
  wordPattern: RegExp
): ContextItem[] {
  const timestamp = Date.now();
  const items: ContextItem[] = [];
  const comments: string[] = [];
  content.replace(LINE_COMMENT, (m) => {
    comments.push(m);
    return " ".repeat(m.length);
  });
  content.replace(BLOCK_COMMENT, (m) => {
    comments.push(m);
    return " ".repeat(m.length);
  });
  for (const comment of comments) {
    if (wordPattern.test(comment)) {
      const trimmed = comment
        .replace(/^\s*\/\/\s*|\s*\/\*\s*|\s*\*\/\s*|\s*\*\s*/g, "")
        .trim();
      if (trimmed)
        items.push({ type, content: trimmed, filePath, timestamp, projectId });
    }
  }
  return items;
}

/**
 * Extract all context items from file content.
 */
export function extractContext(
  content: string,
  filePath: string,
  projectId: string
): ContextItem[] {
  const timestamp = Date.now();
  const items: ContextItem[] = [];

  // Function names (TS/JS)
  const fnNames = new Set<string>();
  const fnRe =
    /function\s+(\w+)|(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)\s*=>|function\s*\()|(\w+)\s*:\s*function\s*\(|(?:^|[^\w])(\w+)\s*\([^)]*\)\s*(?:\{|=>)/gm;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(content)) !== null) {
    const name = (m[1] ?? m[2] ?? m[3] ?? m[4])?.trim();
    if (
      name &&
      !/^(if|for|while|switch|catch|function|return)$/.test(name)
    )
      fnNames.add(name);
  }
  fnNames.forEach((name) =>
    items.push({
      type: "function",
      content: name,
      filePath,
      timestamp,
      projectId,
    })
  );

  // Class names
  const classRe = /\bclass\s+(\w+)/g;
  while ((m = classRe.exec(content)) !== null) {
    const name = m[1];
    if (name)
      items.push({
        type: "class",
        content: name,
        filePath,
        timestamp,
        projectId,
      });
  }

  // TODO / FIXME
  const todoRe = /\/\/\s*(TODO|FIXME)[^\n]*|\/\*\s*(TODO|FIXME)[\s\S]*?\*\//gi;
  while ((m = todoRe.exec(content)) !== null) {
    const raw = m[0]
      .replace(/^\s*\/\/\s*|\s*\/\*\s*|\s*\*\/\s*|\s*\*\s*/g, "")
      .trim();
    if (raw)
      items.push({
        type: "todo",
        content: raw,
        filePath,
        timestamp,
        projectId,
      });
  }

  // Import / require
  const importRe =
    /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  while ((m = importRe.exec(content)) !== null) {
    const mod = m[1] ?? m[2];
    if (mod)
      items.push({
        type: "import",
        content: mod,
        filePath,
        timestamp,
        projectId,
      });
  }

  // Architecture decision comments (because, decided, chose, reason)
  items.push(
    ...extractCommentsContaining(
      content,
      filePath,
      projectId,
      "architecture-decision",
      ADR_PATTERN
    )
  );

  return items;
}
