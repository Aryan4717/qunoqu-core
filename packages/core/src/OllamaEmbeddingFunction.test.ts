import { describe, it, expect, vi, beforeEach } from "vitest";
import { OllamaEmbeddingFunction } from "./OllamaEmbeddingFunction.js";

describe("OllamaEmbeddingFunction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("generate calls Ollama API and returns embeddings", async () => {
    const mockEmbedding = [0.1, 0.2, 0.3];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: mockEmbedding }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const fn = new OllamaEmbeddingFunction({
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text",
    });
    const result = await fn.generate(["hello world"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", prompt: "hello world" }),
      })
    );
    expect(result).toEqual([mockEmbedding]);
  });

  it("generate returns multiple embeddings for multiple texts", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: [1, 2, 3] }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: [4, 5, 6] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const fn = new OllamaEmbeddingFunction();
    const result = await fn.generate(["a", "b"]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([1, 2, 3]);
    expect(result[1]).toEqual([4, 5, 6]);
  });

  it("throws when Ollama returns non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, text: async () => "Not found" }));

    const fn = new OllamaEmbeddingFunction();
    await expect(fn.generate(["x"])).rejects.toThrow("Ollama embedding failed");
  });
});
