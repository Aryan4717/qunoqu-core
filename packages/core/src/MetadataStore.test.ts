import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";
import { MetadataStore } from "./MetadataStore.js";

describe("MetadataStore", () => {
  let store: MetadataStore;
  let tmpDir: string;

  function openTestDb(): MetadataStore {
    tmpDir = mkdtempSync(join(tmpdir(), "qunoqu-db-"));
    return new MetadataStore({ dbPath: join(tmpDir, "memory.db") });
  }

  afterEach(() => {
    if (store) store.close();
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("creates db and runs migrations on init", () => {
    store = openTestDb();
    const version = store.getDbPath();
    expect(version).toBeTruthy();
    store.close();
  });

  it("insertProject returns id and project is stored", () => {
    store = openTestDb();
    const id = store.insertProject({ name: "my-app", root_path: "/home/my-app" });
    expect(id).toBeTruthy();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    const items = store.getByProject(id);
    expect(items).toEqual([]);
    store.close();
  });

  it("insertContextItem and getByProject", () => {
    store = openTestDb();
    const projectId = store.insertProject({ name: "p", root_path: "/p" });
    const itemId = store.insertContextItem({
      project_id: projectId,
      type: "file_change",
      content: "function foo() {}",
      file_path: "/p/src/index.ts",
    });
    expect(itemId).toBeTruthy();
    const rows = store.getByProject(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(itemId);
    expect(rows[0].type).toBe("file_change");
    expect(rows[0].content).toBe("function foo() {}");
    expect(rows[0].file_path).toBe("/p/src/index.ts");
    expect(rows[0].is_stale).toBe(false);
    expect(Array.isArray(rows[0].tags)).toBe(true);
  });

  it("getRecent returns n most recent items", () => {
    store = openTestDb();
    const p1 = store.insertProject({ name: "p1", root_path: "/p1" });
    const p2 = store.insertProject({ name: "p2", root_path: "/p2" });
    store.insertContextItem({ project_id: p1, type: "comment", content: "first" });
    store.insertContextItem({ project_id: p2, type: "comment", content: "second" });
    store.insertContextItem({ project_id: p1, type: "comment", content: "third" });
    const recent = store.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].content).toBe("third");
    expect(recent[1].content).toBe("second");
  });

  it("keywordSearch returns items matching query terms", () => {
    store = openTestDb();
    const projectId = store.insertProject({ name: "p", root_path: "/p" });
    store.insertContextItem({
      project_id: projectId,
      type: "decision",
      content: "We use WebSockets for real-time updates",
      file_path: "/p/service.ts",
    });
    store.insertContextItem({
      project_id: projectId,
      type: "comment",
      content: "Redis cache for sessions",
      file_path: null,
    });
    store.insertContextItem({
      project_id: projectId,
      type: "file_change",
      content: "WebSockets and Redis are configured",
      file_path: "/p/config.ts",
    });
    const results = store.keywordSearch("WebSockets", { projectId, limit: 10 });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some((r) => r.content.includes("WebSockets for real-time"))).toBe(true);
    expect(results.some((r) => r.content.includes("WebSockets and Redis"))).toBe(true);
    const limited = store.keywordSearch("WebSockets", { projectId, limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("markStale sets is_stale = true", () => {
    store = openTestDb();
    const projectId = store.insertProject({ name: "p", root_path: "/p" });
    const id1 = store.insertContextItem({
      project_id: projectId,
      type: "decision",
      content: "use Redis",
    });
    const id2 = store.insertContextItem({
      project_id: projectId,
      type: "decision",
      content: "use Postgres",
    });
    store.markStale([id1]);
    const rows = store.getByProject(projectId);
    const r1 = rows.find((r) => r.id === id1);
    const r2 = rows.find((r) => r.id === id2);
    expect(r1?.is_stale).toBe(true);
    expect(r2?.is_stale).toBe(false);
  });

  it("deleteOlderThan removes old items", async () => {
    store = openTestDb();
    const projectId = store.insertProject({ name: "p", root_path: "/p" });
    store.insertContextItem({
      project_id: projectId,
      type: "comment",
      content: "old",
    });
    const recentBefore = store.getRecent(10);
    expect(recentBefore).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 15));
    const deleted = store.deleteOlderThan(0);
    expect(deleted).toBe(1);
    const recentAfter = store.getRecent(10);
    expect(recentAfter).toHaveLength(0);
  });

  it("insertDecision and getDecisions", () => {
    store = openTestDb();
    const projectId = store.insertProject({ name: "p", root_path: "/p" });
    const decisionId = store.insertDecision({
      project_id: projectId,
      title: "Use SQLite",
      rationale: "Local-first and no server",
      source_file: "/p/README.md",
    });
    expect(decisionId).toBeTruthy();
    const all = store.getDecisions();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Use SQLite");
    expect(all[0].rationale).toBe("Local-first and no server");
    expect(all[0].source_file).toBe("/p/README.md");
    const byProject = store.getDecisions(projectId);
    expect(byProject).toHaveLength(1);
    const other = store.getDecisions("other-uuid");
    expect(other).toHaveLength(0);
  });

  it("stores tags as JSON array", () => {
    store = openTestDb();
    const projectId = store.insertProject({ name: "p", root_path: "/p" });
    store.insertContextItem({
      project_id: projectId,
      type: "comment",
      content: "tagged",
      tags: ["a", "b"],
    });
    const rows = store.getByProject(projectId);
    expect(rows[0].tags).toEqual(["a", "b"]);
  });
});
