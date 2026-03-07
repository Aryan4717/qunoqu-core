/**
 * FileWatcher – watches a project directory and emits context-captured events.
 */

import chokidar from "chokidar";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { EventEmitter } from "events";
import { extractContext } from "./extractContext.js";
import type { ContextItem } from "./types.js";
import { DEFAULT_IGNORE_PATTERNS } from "./types.js";
import { filterContextItem } from "./PrivacyFilter.js";

export const CONTEXT_CAPTURED_EVENT = "context-captured";

export interface FileWatcherOptions {
  /** Project identifier for emitted context items */
  projectId?: string;
  /** Glob patterns to ignore (default: node_modules, .git, dist, build). Or use ignoreFn to skip paths entirely and avoid EMFILE. */
  ignore?: string[];
  /** If true, use a function-based ignore so node_modules/.git/dist/build are never traversed (recommended for daemon). */
  useIgnoreFn?: boolean;
}

export interface FileWatcherEvents {
  [CONTEXT_CAPTURED_EVENT]: (items: ContextItem[]) => void;
}

export class FileWatcher extends EventEmitter {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private hashCache = new Map<string, string>();
  private projectDir: string;
  private projectId: string;
  private ignore: string[];
  private useIgnoreFn: boolean;

  constructor(
    projectDirOrOptions?: string | FileWatcherOptions,
    maybeOptions?: FileWatcherOptions
  ) {
    super();
    const options: FileWatcherOptions =
      typeof projectDirOrOptions === "string"
        ? maybeOptions ?? {}
        : projectDirOrOptions ?? {};
    this.projectDir = typeof projectDirOrOptions === "string" ? projectDirOrOptions : "";
    this.projectId = options.projectId ?? "default";
    this.ignore = options.ignore ?? [...DEFAULT_IGNORE_PATTERNS];
    this.useIgnoreFn = options.useIgnoreFn ?? false;
  }

  /** Returns true if path should be ignored (never traverse). Prevents EMFILE from node_modules. */
  private static ignoredFn(path: string): boolean {
    const n = path.replace(/\\/g, "/");
    return (
      n.includes("/node_modules/") ||
      n.startsWith("node_modules") ||
      n.includes("/.git/") ||
      n.startsWith(".git") ||
      n.includes("/dist/") ||
      n.startsWith("dist/") ||
      n.includes("/build/") ||
      n.startsWith("build/")
    );
  }

  /**
   * Watch a project directory recursively. On file change/add, extract context and emit.
   * Uses this.projectDir when no argument is passed.
   */
  watch(projectDir?: string): this {
    const dir = projectDir ?? this.projectDir;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    const ignored = this.useIgnoreFn ? FileWatcher.ignoredFn : this.ignore;
    this.watcher = chokidar.watch(dir, {
      persistent: true,
      ignoreInitial: false,
      ignored,
      awaitWriteFinish: { stabilityThreshold: 100 },
    });

    const handleChange = (filePath: string) => {
      this.processFile(filePath).catch((err: unknown) => {
        super.emit("error", err);
      });
    };

    this.watcher.on("add", handleChange);
    this.watcher.on("change", handleChange);
    this.watcher.on("unlink", (filePath: string) => {
      this.hashCache.delete(filePath);
    });

    return this;
  }

  private async processFile(filePath: string): Promise<void> {
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return;
    }

    const hash = createHash("sha256").update(content).digest("hex");
    const prev = this.hashCache.get(filePath);
    if (prev === hash) return;
    this.hashCache.set(filePath, hash);

    const rawItems = extractContext(content, filePath, this.projectId);
    const items = rawItems
      .map((item) => filterContextItem(item, this.projectDir || undefined))
      .filter((x): x is ContextItem => x !== null);
    if (items.length > 0) {
      super.emit(CONTEXT_CAPTURED_EVENT, items);
    }
  }

  /** Stop watching. */
  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.hashCache.clear();
  }
}
