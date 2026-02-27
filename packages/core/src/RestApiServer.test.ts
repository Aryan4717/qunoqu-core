import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";
import request from "supertest";
import { createRestApiServer } from "./RestApiServer.js";
import { MetadataStore } from "./MetadataStore.js";

describe("RestApiServer", () => {
  let tmpDir: string;
  let close: () => Promise<void>;
  const testToken = "test-token-12345";

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "qunoqu-rest-"));
  });

  afterEach(async () => {
    if (close) await close().catch(() => {});
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  function createTestServer(port?: number) {
    const s = createRestApiServer({
      port: port ?? 0,
      dbPath: join(tmpDir, "memory.db"),
      graphPath: join(tmpDir, "graph.json"),
      token: testToken,
    });
    close = s.close;
    return s.app;
  }

  /** Create a project in the same DB and return its id (for POST /decision FK). */
  function createProjectInDb(): string {
    const store = new MetadataStore({ dbPath: join(tmpDir, "memory.db") });
    const id = store.insertProject({ name: "test-project", root_path: "/tmp/test" });
    store.close();
    return id;
  }

  it("GET /health returns status and does not require auth", async () => {
    const app = createTestServer();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", version: "1.0.0" });
    expect(typeof res.body.memoriesCount).toBe("number");
    expect(["ok", "unavailable"]).toContain(res.body.ollamaStatus);
  });

  it("GET /openapi.json returns OpenAPI spec and does not require auth", async () => {
    const app = createTestServer();
    const res = await request(app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.0.0");
    expect(res.body.paths["/context"]).toBeDefined();
    expect(res.body.paths["/decision"]).toBeDefined();
    expect(res.body.paths["/summary/{projectId}"]).toBeDefined();
  });

  it("GET /context returns 401 without Bearer token", async () => {
    const app = createTestServer();
    const res = await request(app).get("/context").query({ q: "foo" });
    expect(res.status).toBe(401);
  });

  it("GET /context returns 200 with valid Bearer token", async () => {
    const app = createTestServer();
    const res = await request(app)
      .get("/context")
      .query({ q: "test" })
      .set("Authorization", `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.query).toBe("test");
  });

  it("POST /decision returns 400 without projectId", async () => {
    const app = createTestServer();
    const res = await request(app)
      .post("/decision")
      .set("Authorization", `Bearer ${testToken}`)
      .send({ title: "T", rationale: "R" });
    expect(res.status).toBe(400);
  });

  it("POST /decision saves and returns id with valid body and token", async () => {
    const projectId = createProjectInDb();
    const app = createTestServer();
    const res = await request(app)
      .post("/decision")
      .set("Authorization", `Bearer ${testToken}`)
      .send({ title: "Use REST", rationale: "For non-MCP clients", projectId });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    expect(res.body.id).toBeTruthy();
  });

  it("GET /summary/:projectId returns 200 with auth", async () => {
    const app = createTestServer();
    const res = await request(app)
      .get("/summary/some-project-id")
      .set("Authorization", `Bearer ${testToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recentItems)).toBe(true);
    expect(Array.isArray(res.body.decisions)).toBe(true);
    expect(Array.isArray(res.body.graphSummary)).toBe(true);
    expect(res.body.stats).toMatchObject({ totalContextItems: expect.any(Number), totalDecisions: expect.any(Number) });
  });
});
