/**
 * Ollama embedding function for ChromaDB.
 * Calls Ollama REST API (localhost:11434) with model "nomic-embed-text".
 */

import type { EmbeddingFunction } from "chromadb";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "nomic-embed-text";

export interface OllamaEmbeddingFunctionOptions {
  baseUrl?: string;
  model?: string;
}

export class OllamaEmbeddingFunction implements EmbeddingFunction {
  private baseUrl: string;
  private model: string;

  constructor(options: OllamaEmbeddingFunctionOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async generate(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const embedding = await this.embedOne(text);
      results.push(embedding);
    }
    return results;
  }

  private async embedOne(text: string): Promise<number[]> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/embeddings`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama embedding failed (${res.status}): ${err}`);
    }
    const data = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(data.embedding)) {
      throw new Error("Ollama response missing embedding array");
    }
    return data.embedding;
  }
}
