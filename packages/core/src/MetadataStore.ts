/**
 * SQLite metadata store: ~/.qunoqu/memory.db
 * Tables: projects, context_items, decisions. WAL mode. Schema migrations via schema_version.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type {
  ContextItemRow,
  DecisionRow,
  InsertProjectInput,
  InsertContextItemInput,
  InsertDecisionInput,
} from "./metadataTypes.js";

const QUNOQU_DIR = join(homedir(), ".qunoqu");
const DEFAULT_DB_PATH = join(QUNOQU_DIR, "memory.db");

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_active INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS context_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    type TEXT NOT NULL CHECK(type IN ('file_change', 'terminal_cmd', 'decision', 'comment')),
    content TEXT NOT NULL,
    file_path TEXT,
    embedding_id TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    is_stale INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    rationale TEXT NOT NULL,
    decided_at INTEGER NOT NULL,
    source_file TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_context_items_project ON context_items(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_context_items_created ON context_items(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id)`,
];

function randomId(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

export interface MetadataStoreOptions {
  dbPath?: string;
}

export class MetadataStore {
  private db: Database.Database;
  private dbPath: string;

  constructor(options: MetadataStoreOptions = {}) {
    this.dbPath = options.dbPath ?? DEFAULT_DB_PATH;
    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.runMigrations();
  }

  private getVersion(): number {
    const row = this.db
      .prepare("SELECT MAX(version) as v FROM schema_version")
      .get() as { v: number | null };
    return row?.v ?? 0;
  }

  private runMigrations(): void {
    this.db.exec(MIGRATIONS[0]);
    let version = this.getVersion();
    for (let i = 1; i < MIGRATIONS.length; i++) {
      if (version >= i) continue;
      this.db.exec(MIGRATIONS[i]);
      this.db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(i);
      version = i;
    }
  }

  /** Insert a project. Returns id. */
  insertProject(input: InsertProjectInput): string {
    const id = randomId();
    const t = now();
    this.db
      .prepare(
        "INSERT INTO projects (id, name, root_path, created_at, last_active) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, input.name, input.root_path, t, t);
    return id;
  }

  /** Insert a context item. Returns id. */
  insertContextItem(input: InsertContextItemInput): string {
    const id = randomId();
    const tagsJson = JSON.stringify(input.tags ?? []);
    this.db
      .prepare(
        `INSERT INTO context_items (id, project_id, type, content, file_path, embedding_id, tags, created_at, is_stale)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        id,
        input.project_id,
        input.type,
        input.content,
        input.file_path ?? null,
        input.embedding_id ?? null,
        tagsJson,
        now()
      );
    return id;
  }

  /** Insert a decision. Returns id. */
  insertDecision(input: InsertDecisionInput): string {
    const id = randomId();
    const t = now();
    this.db
      .prepare(
        `INSERT INTO decisions (id, project_id, title, rationale, decided_at, source_file)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.project_id,
        input.title,
        input.rationale,
        t,
        input.source_file ?? null
      );
    return id;
  }

  /** Get all context items for a project, newest first. */
  getByProject(projectId: string): ContextItemRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, project_id, type, content, file_path, embedding_id, tags, created_at, is_stale
         FROM context_items WHERE project_id = ? ORDER BY created_at DESC`
      )
      .all(projectId) as Array<{
        id: string;
        project_id: string;
        type: string;
        content: string;
        file_path: string | null;
        embedding_id: string | null;
        tags: string;
        created_at: number;
        is_stale: number;
      }>;
    return rows.map((r) => ({
      id: r.id,
      project_id: r.project_id,
      type: r.type as ContextItemRow["type"],
      content: r.content,
      file_path: r.file_path,
      embedding_id: r.embedding_id,
      tags: JSON.parse(r.tags) as string[],
      created_at: r.created_at,
      is_stale: r.is_stale !== 0,
    }));
  }

  /** Get n most recent context items across all projects. */
  getRecent(n: number): ContextItemRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, project_id, type, content, file_path, embedding_id, tags, created_at, is_stale
         FROM context_items ORDER BY created_at DESC LIMIT ?`
      )
      .all(n) as Array<{
        id: string;
        project_id: string;
        type: string;
        content: string;
        file_path: string | null;
        embedding_id: string | null;
        tags: string;
        created_at: number;
        is_stale: number;
      }>;
    return rows.map((r) => ({
      id: r.id,
      project_id: r.project_id,
      type: r.type as ContextItemRow["type"],
      content: r.content,
      file_path: r.file_path,
      embedding_id: r.embedding_id,
      tags: JSON.parse(r.tags) as string[],
      created_at: r.created_at,
      is_stale: r.is_stale !== 0,
    }));
  }

  /** Mark context items as stale by id. */
  markStale(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db.prepare(`UPDATE context_items SET is_stale = 1 WHERE id IN (${placeholders})`).run(...ids);
  }

  /** Delete context items older than the given number of days. */
  deleteOlderThan(days: number): number {
    const cutoff = now() - days * 24 * 60 * 60 * 1000;
    const result = this.db.prepare("DELETE FROM context_items WHERE created_at < ?").run(cutoff);
    return result.changes;
  }

  /**
   * Keyword search over context_items content. Tokenizes query and matches any token (OR).
   * Optionally scoped by projectId. Returns items ordered by created_at DESC.
   */
  keywordSearch(
    query: string,
    options: { projectId?: string; limit?: number } = {}
  ): ContextItemRow[] {
    const limit = options.limit ?? 20;
    const tokens = query
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => t.replace(/%/g, "\\%"));
    if (tokens.length === 0) {
      if (options.projectId) {
        return this.getByProject(options.projectId).slice(0, limit);
      }
      return this.getRecent(limit);
    }
    const conditions = tokens.map(() => "content LIKE ?").join(" OR ");
    const params = tokens.map((t) => `%${t}%`);
    const sql = options.projectId
      ? `SELECT id, project_id, type, content, file_path, embedding_id, tags, created_at, is_stale
         FROM context_items WHERE project_id = ? AND (${conditions}) ORDER BY created_at DESC LIMIT ?`
      : `SELECT id, project_id, type, content, file_path, embedding_id, tags, created_at, is_stale
         FROM context_items WHERE ${conditions} ORDER BY created_at DESC LIMIT ?`;
    const runParams = options.projectId ? [options.projectId, ...params, limit] : [...params, limit];
    const rows = this.db.prepare(sql).all(...runParams) as Array<{
      id: string;
      project_id: string;
      type: string;
      content: string;
      file_path: string | null;
      embedding_id: string | null;
      tags: string;
      created_at: number;
      is_stale: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      project_id: r.project_id,
      type: r.type as ContextItemRow["type"],
      content: r.content,
      file_path: r.file_path,
      embedding_id: r.embedding_id,
      tags: JSON.parse(r.tags) as string[],
      created_at: r.created_at,
      is_stale: r.is_stale !== 0,
    }));
  }

  /** Get decisions, optionally filtered by project. */
  getDecisions(projectId?: string): DecisionRow[] {
    if (projectId) {
      return this.db
        .prepare(
          "SELECT id, project_id, title, rationale, decided_at, source_file FROM decisions WHERE project_id = ? ORDER BY decided_at DESC"
        )
        .all(projectId) as DecisionRow[];
    }
    return this.db
      .prepare(
        "SELECT id, project_id, title, rationale, decided_at, source_file FROM decisions ORDER BY decided_at DESC"
      )
      .all() as DecisionRow[];
  }

  /** Close the database. */
  close(): void {
    this.db.close();
  }

  getDbPath(): string {
    return this.dbPath;
  }
}
