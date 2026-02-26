import { describe, it, expect, vi, beforeEach } from "vitest";
import { VectorStore } from "./VectorStore.js";
import type { ContextItem } from "./types.js";

const mockAdd = vi.fn().mockResolvedValue(undefined);
const mockQuery = vi.fn().mockResolvedValue({
  ids: [["id1"]],
  documents: [["doc content"]],
  metadatas: [[{ projectId: "p1", type: "class", filePath: "/f.ts", timestamp: 123 }]],
  distances: [[0.5]],
});
const mockDelete = vi.fn().mockResolvedValue(undefined);

const mockGetOrCreateCollection = vi.fn().mockResolvedValue({
  add: mockAdd,
  query: mockQuery,
  delete: mockDelete,
});

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

describe("VectorStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrCreateCollection.mockResolvedValue({
      add: mockAdd,
      query: mockQuery,
      delete: mockDelete,
    });
  });

  it("addContext deduplicates by content hash", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: new Array(768).fill(0) }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new VectorStore({
      chromaPath: "http://localhost:8000",
      ollamaBaseUrl: "http://localhost:11434",
    });
    const item: ContextItem = {
      type: "architecture-decision",
      content: "same content",
      filePath: "/a.ts",
      timestamp: 100,
      projectId: "proj",
    };
    await store.addContext(item);
    await store.addContext({ ...item });
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it("addContext stores metadata projectId, type, filePath, timestamp", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: new Array(768).fill(0) }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new VectorStore();
    const item: ContextItem = {
      type: "class",
      content: "class Foo {}",
      filePath: "/src/foo.ts",
      timestamp: 200,
      projectId: "my-project",
    };
    await store.addContext(item);
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        metadatas: expect.arrayContaining([
          expect.objectContaining({
            projectId: "my-project",
            type: "class",
            filePath: "/src/foo.ts",
            timestamp: 200,
          }),
        ]),
      })
    );
  });

  it("semanticSearch returns results with score", async () => {
    const store = new VectorStore();
    const results = await store.semanticSearch("query", "proj", 5);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryTexts: ["query"],
        nResults: 5,
        where: { projectId: "proj" },
      })
    );
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("doc content");
    expect(results[0].metadata.projectId).toBe("p1");
    expect(results[0].score).toBeDefined();
  });

  it("deleteByProject calls collection delete with where", async () => {
    const store = new VectorStore();
    await store.deleteByProject("proj-id");
    expect(mockDelete).toHaveBeenCalledWith({ where: { projectId: "proj-id" } });
  });
});
