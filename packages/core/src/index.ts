/**
 * @qunoqu/core – capture + storage engine
 */

export function hello(): string {
  return "qunoqu core";
}

export { FileWatcher, CONTEXT_CAPTURED_EVENT } from "./FileWatcher.js";
export type { FileWatcherOptions, FileWatcherEvents } from "./FileWatcher.js";
export { extractContext } from "./extractContext.js";
export type { ContextItem, ContextItemType } from "./types.js";
export { DEFAULT_IGNORE_PATTERNS } from "./types.js";
