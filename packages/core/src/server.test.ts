import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";
import request from "supertest";
import { createApp } from "./server.js";
import { MetadataStore } from "./MetadataStore.js";

describe("REST API server", () => {
  let tmpDir: string;
  let app: ReturnType<typeof createApp>;
  let projectId: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "qunoqu-server-"));
    const dbPath = join(tmpDir, "memory.db");
    const store = new MetadataStore({ dbPath });
    projectId = store.insertProject({ name: "test", root_path: "/test" });
    store.close();
    app = createApp({
      disableAuth: true,
      dbPath,
      graphPath: join(tmpDir, "graph.json"),
    });
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("GET /health returns status ok and version", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.version).toBeDefined();
    expect(res.body.memoriesCount).toBeDefined();
    expect(res.body.ollamaStatus).toBeDefined();
  });

  it("GET /openapi.json returns OpenAPI spec", async () => {
    const res = await request(app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.0.0");
    expect(res.body.paths["/context"]).toBeDefined();
    expect(res.body.paths["/decision"]).toBeDefined();
    expect(res.body.paths["/summary/{projectId}"]).toBeDefined();
    expect(res.body.paths["/health"]).toBeDefined();
  });

  it("GET /context returns items and query", async () => {
    const res = await request(app).get("/context").query({ q: "test", topK: 3 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.query).toBe("test");
    expect(res.body.projectId).toBeDefined();
  });

  it("POST /decision requires title, rationale, projectId", async () => {
    const res = await request(app).post("/decision").send({ title: "T", rationale: "R", projectId });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    expect(res.body.id).toBeTruthy();
  });

  it("POST /decision returns 400 when body is incomplete", async () => {
    const res = await request(app).post("/decision").send({ title: "T" });
    expect(res.status).toBe(400);
  });

  it("GET /summary/:projectId returns recentItems, decisions, graphSummary, stats", async () => {
    const res = await request(app).get(`/summary/${projectId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recentItems)).toBe(true);
    expect(Array.isArray(res.body.decisions)).toBe(true);
    expect(Array.isArray(res.body.graphSummary)).toBe(true);
    expect(res.body.stats).toBeDefined();
    expect(typeof res.body.stats.contextCount).toBe("number");
    expect(typeof res.body.stats.decisionCount).toBe("number");
  });
});
