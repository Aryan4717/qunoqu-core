/**
 * QunoqDaemon – orchestrates FileWatcher, TerminalCapture, stores, and REST server in the background.
 */

import { appendFileSync, mkdirSync, existsSync, unlinkSync, readFileSync } from "fs";
import { join, dirname, basename } from "path";
import { homedir } from "os";
import type { Server as HttpServerInstance } from "http";
import { FileWatcher, CONTEXT_CAPTURED_EVENT } from "./FileWatcher.js";
import { TerminalCapture, TERMINAL_EVENT } from "./TerminalCapture.js";
import { MetadataStore } from "./MetadataStore.js";
import { VectorStore } from "./VectorStore.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";
import { filterContextItem } from "./PrivacyFilter.js";
import { startServer } from "./server.js";
import type { ContextItem } from "./types.js";
import type { TerminalEvent } from "./types.js";
import type { ContextItemTypeEnum } from "./metadataTypes.js";

const QUNOQU_DIR = join(homedir(), ".qunoqu");

export interface DaemonOptions {
  projectRoot: string;
  projectId: string;
  dbPath?: string;
  restPort?: number;
  logPath?: string;
  pidPath?: string;
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  projectId: string;
  projectRoot: string;
  capturedToday: number;
  totalCaptured: number;
  restServerRunning: boolean;
  startedAt: number | null;
}

export class QunoqDaemon {
  private readonly projectRoot: string;
  private readonly projectId: string;
  private readonly dbPath: string;
  private readonly restPort: number;
  private readonly logPath: string;
  private readonly pidPath: string;

  private metadataStore: MetadataStore | null = null;
  private vectorStore: VectorStore | null = null;
  private knowledgeGraph: KnowledgeGraph | null = null;
  private fileWatcher: FileWatcher | null = null;
  private terminalCapture: TerminalCapture | null = null;
  private restServer: HttpServerInstance | null = null;
  private startedAt: number | null = null;

  constructor(options: DaemonOptions) {
    this.projectRoot = options.projectRoot;
    this.projectId = options.projectId;
    this.dbPath = options.dbPath ?? join(QUNOQU_DIR, "memory.db");
    this.restPort = options.restPort ?? 7384;
    this.logPath = options.logPath ?? join(QUNOQU_DIR, "daemon.log");
    this.pidPath = options.pidPath ?? join(QUNOQU_DIR, "daemon.pid");
  }

  private log(message: string): void {
    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const line = `${new Date().toISOString()}\t${message}\n`;
    try {
      appendFileSync(this.logPath, line, "utf-8");
    } catch {
      // best-effort
    }
  }

  private async syncChromaFromSQLite(): Promise<void> {
    if (!this.metadataStore || !this.vectorStore) return;
    try {
      const hasAny = await this.vectorStore.hasAnyForProject(this.projectId);
      const items = this.metadataStore.getByProject(this.projectId);
      if (hasAny || items.length === 0) return;
      this.log(`Syncing ${items.length} items from SQLite to ChromaDB...`);
      let synced = 0;
      for (const row of items) {
        try {
          const item: ContextItem = {
            type: "todo",
            content: row.content,
            filePath: row.file_path ?? "",
            timestamp: row.created_at,
            projectId: row.project_id,
          };
          await this.vectorStore.addContext(item);
          synced++;
        } catch {
          // skip individual failures
        }
      }
      this.log(`Synced ${synced} items to ChromaDB.`);
    } catch (err) {
      this.log(`syncChromaFromSQLite failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Store one item: filter, SQLite, ChromaDB, KG (if decision), log.
   */
  async storeItem(
    item: ContextItem,
    metaType: ContextItemTypeEnum
  ): Promise<void> {
    const filtered = filterContextItem(item, this.projectRoot);
    if (filtered === null) {
      this.log(`Filtered: dropped item (path or content policy)`);
      return;
    }
    if (!this.metadataStore) return;
    this.metadataStore.ensureProject(this.projectId, basename(this.projectRoot), this.projectRoot);
    const id = this.metadataStore.insertContextItem({
      project_id: this.projectId,
      type: metaType,
      content: filtered.content,
      file_path: filtered.filePath || null,
    });
    if (this.vectorStore) {
      try {
        await this.vectorStore.addContext(filtered);
      } catch (err) {
        this.log(`ChromaDB addContext failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (metaType === "decision" && this.knowledgeGraph) {
      this.knowledgeGraph.addNode({
        id: `decision:${this.projectId}:${id}`,
        type: "decision",
        label: filtered.content.slice(0, 80),
        projectId: this.projectId,
        metadata: { rationale: filtered.content.slice(0, 200) },
      });
      this.knowledgeGraph.save();
    }
    this.log(`Stored: ${metaType} ${id}`);
  }

  async start(): Promise<void> {
    this.log("Daemon starting...");
    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    this.metadataStore = new MetadataStore({ dbPath: this.dbPath });
    this.knowledgeGraph = new KnowledgeGraph({ graphPath: join(QUNOQU_DIR, "graph.json") });
    try {
      this.vectorStore = new VectorStore({
        chromaPath: "http://localhost:8000",
        ollamaBaseUrl: "http://localhost:11434",
      });
    } catch (err) {
      this.log(`VectorStore init warning: ${err instanceof Error ? err.message : String(err)}`);
      this.vectorStore = null;
    }
    await this.syncChromaFromSQLite();
    this.fileWatcher = new FileWatcher(this.projectRoot, {
      projectId: this.projectId,
      useIgnoreFn: true,
    });
    this.fileWatcher.on(CONTEXT_CAPTURED_EVENT, (items: ContextItem[]) => {
      for (const item of items) {
        const filtered = filterContextItem(item, this.projectRoot);
        if (filtered !== null) {
          this.storeItem(filtered, "file_change").catch((err) => {
            this.log(`ERROR storeItem file: ${err instanceof Error ? err.message : String(err)}`);
          });
        }
      }
    });
    this.fileWatcher.on("error", (err: unknown) => {
      this.log(`ERROR FileWatcher: ${err instanceof Error ? err.message : String(err)}`);
    });
    this.fileWatcher.watch();
    this.terminalCapture = new TerminalCapture({
      projectId: this.projectId,
    });
    this.terminalCapture.on(TERMINAL_EVENT, (event: TerminalEvent) => {
      const item: ContextItem = {
        type: "todo",
        content: `${event.command}\n${event.output || ""}`.trim().slice(0, 2000),
        filePath: "",
        timestamp: event.timestamp,
        projectId: event.projectId,
      };
      const filtered = filterContextItem(item, this.projectRoot);
      if (filtered !== null) {
        this.storeItem(filtered, "terminal_cmd").catch((err) => {
          this.log(`ERROR storeItem terminal: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    });
    this.terminalCapture.on("error", (err: unknown) => {
      this.log(`ERROR TerminalCapture: ${err instanceof Error ? err.message : String(err)}`);
    });
    await this.terminalCapture.start();
    const { server, port } = await startServer({
      port: this.restPort,
      dbPath: this.dbPath,
      graphPath: join(QUNOQU_DIR, "graph.json"),
    });
    this.restServer = server;
    this.startedAt = Date.now();
    this.log(`Daemon started (PID: ${process.pid}), REST on port ${port}`);
  }

  async stop(): Promise<void> {
    if (this.fileWatcher) {
      await this.fileWatcher.close();
      this.fileWatcher = null;
    }
    if (this.terminalCapture) {
      await this.terminalCapture.stop();
      this.terminalCapture = null;
    }
    if (this.restServer) {
      await new Promise<void>((resolve, reject) => {
        this.restServer!.close((err) => {
          this.restServer = null;
          if (err) reject(err);
          else resolve();
        });
      });
    }
    if (this.metadataStore) {
      this.metadataStore.close();
      this.metadataStore = null;
    }
    if (existsSync(this.pidPath)) {
      try {
        unlinkSync(this.pidPath);
      } catch {
        // ignore
      }
    }
    this.startedAt = null;
    this.log("Daemon stopped");
  }

  getStatus(): DaemonStatus {
    let pid: number | null = null;
    if (existsSync(this.pidPath)) {
      try {
        const raw = readFileSync(this.pidPath, "utf-8").trim();
        pid = parseInt(raw, 10);
        if (Number.isNaN(pid)) pid = null;
      } catch {
        pid = null;
      }
    }
    let capturedToday = 0;
    let totalCaptured = 0;
    if (this.metadataStore) {
      const items = this.metadataStore.getByProject(this.projectId);
      totalCaptured = items.length;
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      capturedToday = items.filter((i) => i.created_at >= startOfToday.getTime()).length;
    } else {
      try {
        const store = new MetadataStore({ dbPath: this.dbPath });
        const items = store.getByProject(this.projectId);
        totalCaptured = items.length;
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        capturedToday = items.filter((i) => i.created_at >= startOfToday.getTime()).length;
        store.close();
      } catch {
        // ignore
      }
    }
    return {
      running: this.restServer != null,
      pid,
      projectId: this.projectId,
      projectRoot: this.projectRoot,
      capturedToday,
      totalCaptured,
      restServerRunning: this.restServer != null,
      startedAt: this.startedAt,
    };
  }

  isRunning(): boolean {
    return this.restServer != null;
  }
}
