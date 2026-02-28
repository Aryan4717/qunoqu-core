/**
 * ChromaDB vector store for semantic search over context items.
 * Collection "qunoqu_context" with embeddings via Ollama nomic-embed-text.
 * Deduplication via content hash; graceful fallback when Ollama is unavailable.
 */

import { ChromaClient, type Collection } from "chromadb";
import { createHash } from "crypto";
import type { ContextItem } from "./types.js";
import { OllamaEmbeddingFunction } from "./OllamaEmbeddingFunction.js";

const COLLECTION_NAME = "qunoqu_context";
const MAX_CHUNK_CHARS = 2000;
const OLLAMA_MODEL = "nomic-embed-text";

export interface VectorStoreOptions {
  chromaPath?: string;
  ollamaBaseUrl?: string;
}

export interface SemanticSearchResult {
  id: string;
  content: string;
  metadata: {
    projectId: string;
    type: string;
    filePath: string | null;
    timestamp: number;
    unembedded?: boolean;
  };
  score?: number;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > start) end = lastSpace + 1;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter((c) => c.length > 0);
}

export class VectorStore {
  private client: ChromaClient;
  private embeddingFunction: OllamaEmbeddingFunction;
  private ollamaBaseUrl: string;
  private collection: Collection | null = null;
  private seenHashes: Set<string> = new Set();
  private ollamaAvailable: boolean | null = null;

  constructor(options: VectorStoreOptions = {}) {
    const path = options.chromaPath ?? "http://localhost:8000";
    this.ollamaBaseUrl = options.ollamaBaseUrl ?? "http://localhost:11434";
    this.client = new ChromaClient(
      path.startsWith("http")
        ? (() => {
            const u = new URL(path);
            return {
              host: u.hostname,
              port: u.port ? parseInt(u.port, 10) : 8000,
              ssl: u.protocol === "https:",
            };
          })()
        : { host: "localhost", port: 8000 }
    );
    this.embeddingFunction = new OllamaEmbeddingFunction({
      baseUrl: this.ollamaBaseUrl,
      model: OLLAMA_MODEL,
    });
  }

  private async getCollection(): Promise<Collection> {
    if (this.collection) return this.collection;
    try {
      this.collection = await this.client.getOrCreateCollection({
        name: COLLECTION_NAME,
        embeddingFunction: this.embeddingFunction,
      });
    } catch {
      this.collection = await this.client.createCollection({
        name: COLLECTION_NAME,
        embeddingFunction: this.embeddingFunction,
      });
    }
    return this.collection;
  }

  private async checkOllama(): Promise<boolean> {
    if (this.ollamaAvailable !== null) return this.ollamaAvailable;
    try {
      const res = await fetch(
        `${this.ollamaBaseUrl.replace(/\/$/, "")}/api/tags`,
        {
          method: "GET",
        }
      );
      this.ollamaAvailable = res.ok;
    } catch {
      this.ollamaAvailable = false;
    }
    return this.ollamaAvailable;
  }

  /**
   * Add a context item. Chunks if over ~500 tokens, dedupes by content hash,
   * stores with metadata. If Ollama is down, stores with zero vector and marks unembedded.
   */
  async addContext(item: ContextItem): Promise<void> {
    const hash = contentHash(item.content);
    if (this.seenHashes.has(hash)) return;
    this.seenHashes.add(hash);

    const chunks = chunkText(item.content, MAX_CHUNK_CHARS);
    const coll = await this.getCollection();
    const metadata = {
      projectId: item.projectId,
      type: item.type,
      filePath: item.filePath,
      timestamp: item.timestamp,
    };

    const canEmbed = await this.checkOllama();
    if (canEmbed) {
      const ids = chunks.map((_, i) => `${hash}-${i}`);
      const metadatas = chunks.map(() => ({ ...metadata }));
      await coll.add({
        ids,
        documents: chunks,
        metadatas,
      });
    } else {
      const ids = chunks.map((_, i) => `${hash}-${i}`);
      const metadatas = chunks.map(() => ({ ...metadata, unembedded: true }));
      const dim = 768;
      const zeroEmbedding = new Array(dim).fill(0);
      await coll.add({
        ids,
        documents: chunks,
        embeddings: chunks.map(() => zeroEmbedding),
        metadatas,
      });
    }
  }

  /**
   * Semantic search. Embeds query, searches with cosine similarity, returns topK results.
   */
  async semanticSearch(
    query: string,
    projectId: string,
    topK: number
  ): Promise<SemanticSearchResult[]> {
    const coll = await this.getCollection();
    const result = await coll.query({
      queryTexts: [query],
      nResults: topK,
      where: { projectId },
      include: ["documents", "metadatas", "distances"],
    });

    const docs = result.documents?.[0] ?? [];
    const metas = result.metadatas?.[0] ?? [];
    const distances = result.distances?.[0];
    const ids = result.ids?.[0] ?? [];

    return docs.map((content, i) => {
      const meta = (metas[i] ?? {}) as Record<string, unknown>;
      const dist = distances?.[i];
      return {
        id: (ids[i] as string) ?? "",
        content: content ?? "",
        metadata: {
          projectId: (meta.projectId as string) ?? "",
          type: (meta.type as string) ?? "",
          filePath: (meta.filePath as string | null) ?? null,
          timestamp: (meta.timestamp as number) ?? 0,
          unembedded: meta.unembedded as boolean | undefined,
        },
        score:
          dist !== undefined && dist !== null ? 1 - dist / 2 : undefined,
      };
    });
  }

  /**
   * Delete all vectors for a project.
   */
  async deleteByProject(projectId: string): Promise<void> {
    const coll = await this.getCollection();
    await coll.delete({ where: { projectId } });
  }

  /**
   * Return whether ChromaDB has any documents for this project (for sync heuristic).
   */
  async hasAnyForProject(projectId: string): Promise<boolean> {
    try {
      const coll = await this.getCollection();
      const result = await coll.get({
        where: { projectId },
        limit: 1,
      });
      const ids = result.ids ?? [];
      return ids.length > 0;
    } catch {
      return false;
    }
  }
}
