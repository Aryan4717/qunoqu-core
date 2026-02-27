/**
 * E2E integration test: full capture → recall pipeline (Phase 1 MVP "magic moment").
 * Simulates: init → file save → capture/embed → MCP recall_context → REST GET /context.
 * Mocks: Ollama (embedding), ChromaDB. Uses temp SQLite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import request from "supertest";
import { MetadataStore } from "./MetadataStore.js";
import { VectorStore } from "./VectorStore.js";
import { createApp } from "./server.js";
import { extractContext } from "./extractContext.js";

const DECISION_CONTENT =
  "// We chose WebSockets over polling because of latency requirements for real-time order tracking";
const RECALL_QUERY = "why did we choose WebSockets";
const REST_QUERY = "websockets";
const MIN_RELEVANCE_SCORE = 0.7;

const mockAdd = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockResolvedValue(undefined);
const mockQuery = vi.fn();
const mockGetOrCreateCollection = vi.fn();

vi.mock("chromadb", () => ({
  ChromaClient: vi.fn().mockImplementation(() => ({
    getOrCreateCollection: mockGetOrCreateCollection,
    createCollection: vi.fn().mockResolvedValue({
      add: mockAdd,
      query: mockQuery,
      delete: mockDelete,
    }),
  })),
}));

describe("E2E: capture → recall pipeline", () => {
  let projectRoot: string;
  let dbPath: string;
  let graphPath: string;
  let projectId: string;
  let metadataStore: MetadataStore;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "qunoqu-e2e-"));
    projectRoot = root;
    dbPath = join(root, "memory.db");
    graphPath = join(root, "graph.json");
    projectId = "";

    mockGetOrCreateCollection.mockResolvedValue({
      add: mockAdd,
      query: mockQuery,
      delete: mockDelete,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: new Array(768).fill(0.1) }),
      })
    );
  });

  function setMockQueryReturn(pid: string) {
    mockQuery.mockResolvedValue({
      ids: [["e2e-decision-id"]],
      documents: [[DECISION_CONTENT]],
      metadatas: [[
        {
          projectId: pid,
          type: "file_change",
          filePath: join(projectRoot, "src", "decisions.ts"),
          timestamp: Date.now(),
        },
      ]],
      distances: [[0.5]],
    });
  }

  afterEach(() => {
    if (metadataStore) metadataStore.close();
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  it("init → file save → capture → recall (MCP logic) and REST GET /context return decision with relevance", async () => {
    // 1. Simulate qunoqu init on a temporary test directory
    metadataStore = new MetadataStore({ dbPath });
    projectId = metadataStore.insertProject({
      name: "e2e-test",
      root_path: projectRoot,
    });
    setMockQueryReturn(projectId);

    const config = {
      projectId,
      createdAt: Date.now(),
      version: "0.0.0",
    };
    writeFileSync(
      join(projectRoot, ".qunoqu-config.json"),
      JSON.stringify(config, null, 2),
      "utf-8"
    );

    // 2. Simulate a file save event with the decision content
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    const filePath = join(projectRoot, "src", "decisions.ts");
    writeFileSync(filePath, DECISION_CONTENT, "utf-8");
    const items = extractContext(DECISION_CONTENT, filePath, projectId);
    expect(items.length).toBeGreaterThan(0);

    // 3. Capture pipeline: store in SQLite + embed (mock Ollama)
    for (const item of items) {
      metadataStore.insertContextItem({
        project_id: projectId,
        type: "file_change",
        content: item.content,
        file_path: item.filePath,
        tags: [item.type],
      });
    }

    const vectorStore = new VectorStore({
      chromaPath: "http://localhost:8000",
      ollamaBaseUrl: "http://localhost:11434",
    });
    for (const item of items) {
      await vectorStore.addContext({
        type: item.type,
        content: item.content,
        filePath: item.filePath,
        timestamp: item.timestamp,
        projectId: item.projectId,
      });
    }

    // 4. Call recall (same logic as MCP recall_context): keyword + vector
    const keywordRows = metadataStore.keywordSearch(RECALL_QUERY, {
      projectId,
      limit: 10,
    });
    const vectorResults = await vectorStore.semanticSearch(RECALL_QUERY, projectId, 5);

    const combinedContent = [
      ...vectorResults.map((r) => r.content),
      ...keywordRows.map((r) => r.content),
    ].join(" ");
    expect(combinedContent).toContain("WebSockets");
    expect(combinedContent).toContain("latency");
    const hasRelevantScore = vectorResults.some(
      (r) => r.score !== undefined && r.score >= MIN_RELEVANCE_SCORE
    );
    expect(hasRelevantScore).toBe(true);

    // 5. REST API GET /context?q=websockets returns the same item
    const app = createApp({
      disableAuth: true,
      dbPath,
      graphPath,
      chromaPath: "http://localhost:8000",
      ollamaBaseUrl: "http://localhost:11434",
    });
    const res = await request(app)
      .get("/context")
      .query({ q: REST_QUERY, projectId, topK: 5 });
    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
    const restContent = (res.body.items as Array<{ content: string }>)
      .map((i) => i.content)
      .join(" ");
    expect(restContent).toContain("WebSockets");
    expect(restContent).toContain("latency");
  }, 15_000);
});
