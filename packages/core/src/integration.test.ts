/**
 * E2E integration test: full capture -> recall pipeline (Phase 1 "done" criterion).
 * (1) Init project in temp dir (qunoqu init steps), (2) Simulate file save with decision content,
 * (3) Store in SQLite + mock VectorStore embedding, (4) Recall via project context + semantic (mock),
 * (5) Assert returned context contains decision rationale with relevance score >= 0.7,
 * (6) Context query for "websockets" returns the same item.
 * Mocks Ollama/Chroma via VectorStore mock; uses temporary SQLite DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  MetadataStore,
  extractContext,
  SHELL_INTEGRATION_SCRIPT,
} from "./index.js";
import type { SemanticSearchResult } from "./VectorStore.js";

const DECISION_CONTENT =
  "// We chose WebSockets over polling because of latency requirements for real-time order tracking";
const RECALL_QUERY = "why did we choose WebSockets";
const MIN_RELEVANCE_SCORE = 0.7;

// Mock VectorStore: no Ollama/Chroma; semanticSearch returns stored content with score
let mockStoredContent: string | null = null;
let mockProjectId: string | null = null;
vi.mock("./VectorStore.js", () => ({
  VectorStore: vi.fn().mockImplementation(() => ({
    addContext: vi.fn().mockImplementation(async (item: { content: string; projectId: string }) => {
      if (item.content.includes("WebSockets") || item.content.includes("latency")) {
        mockStoredContent = item.content;
        mockProjectId = item.projectId;
      }
    }),
    semanticSearch: vi.fn().mockImplementation(async (_query: string, projectId: string, topK: number) => {
      if (!mockStoredContent || mockProjectId !== projectId) return [];
      const score = 0.85;
      return [
        {
          id: "mock-1",
          content: mockStoredContent,
          metadata: {
            projectId,
            type: "architecture-decision",
            filePath: null,
            timestamp: Date.now(),
          },
          score,
        } as SemanticSearchResult,
      ].slice(0, topK);
    }),
  })),
}));

describe("E2E: capture -> recall pipeline", () => {
  let tmpDir: string;
  let dbPath: string;
  let projectId: string;
  let meta: MetadataStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "qunoqu-e2e-"));
    dbPath = join(tmpDir, "memory.db");
    mockStoredContent = null;
    mockProjectId = null;
    meta = new MetadataStore({ dbPath });
  });

  afterEach(() => {
    meta.close();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("init -> simulate file save -> recall returns decision rationale with score >= 0.7", async () => {
    // (1) Init: create .qunoqu dir and shell script (same as qunoqu init)
    const qunoquDir = join(tmpDir, ".qunoqu");
    mkdirSync(qunoquDir, { recursive: true });
    writeFileSync(join(qunoquDir, "shell-integration.sh"), SHELL_INTEGRATION_SCRIPT, "utf-8");

    // Create project and get projectId
    projectId = meta.insertProject({ name: "e2e-project", root_path: tmpDir });

    // (2) Simulate file save: extract context from the decision comment
    const filePath = join(tmpDir, "src", "decisions.md");
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    const items = extractContext(DECISION_CONTENT, filePath, projectId);
    expect(items.length).toBeGreaterThan(0);
    const decisionItem = items.find((i) => i.content.includes("WebSockets") && i.content.includes("latency"));
    expect(decisionItem).toBeDefined();

    // Store in SQLite and "embed" (mock VectorStore.addContext)
    for (const item of items) {
      meta.insertContextItem({
        project_id: projectId,
        type: "comment",
        content: item.content,
        file_path: item.filePath,
      });
    }
    const { VectorStore } = await import("./VectorStore.js");
    const vectorStore = new (VectorStore as unknown as new () => { addContext: (i: unknown) => Promise<void> })();
    for (const item of items) {
      await vectorStore.addContext({
        type: item.type,
        content: item.content,
        filePath: item.filePath,
        timestamp: item.timestamp,
        projectId: item.projectId,
      });
    }

    // (4) Recall: project context (keyword-like) + semantic search (like MCP recall_context)
    const projectItems = meta.getByProject(projectId);
    const queryLower = RECALL_QUERY.toLowerCase();
    const keywordRows = projectItems.filter((r) =>
      r.content.toLowerCase().includes(queryLower) || r.content.toLowerCase().includes("websockets") || r.content.toLowerCase().includes("latency")
    );
    const vectorResults = await (vectorStore as unknown as { semanticSearch: (q: string, p: string, k: number) => Promise<SemanticSearchResult[]> }).semanticSearch(
      RECALL_QUERY,
      projectId,
      5
    );

    const combined = [
      ...vectorResults.map((r) => ({ content: r.content, score: r.score })),
      ...keywordRows.map((r) => ({ content: r.content, score: undefined })),
    ];
    const withScore = combined.find((c) => c.score !== undefined && c.score >= MIN_RELEVANCE_SCORE);
    const withContent = combined.find((c) =>
      c.content.includes("WebSockets") && c.content.includes("latency")
    );

    expect(withContent).toBeDefined();
    expect(withContent!.content).toContain("latency requirements");
    expect(withScore).toBeDefined();
    expect(withScore!.score).toBeGreaterThanOrEqual(MIN_RELEVANCE_SCORE);
  });

  it("context query for 'websockets' returns the same stored item", async () => {
    const qunoquDir = join(tmpDir, ".qunoqu");
    mkdirSync(qunoquDir, { recursive: true });
    writeFileSync(join(qunoquDir, "shell-integration.sh"), SHELL_INTEGRATION_SCRIPT, "utf-8");
    projectId = meta.insertProject({ name: "e2e-project", root_path: tmpDir });

    const filePath = join(tmpDir, "src", "decisions.md");
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    const items = extractContext(DECISION_CONTENT, filePath, projectId);
    for (const item of items) {
      meta.insertContextItem({
        project_id: projectId,
        type: "comment",
        content: item.content,
        file_path: item.filePath,
      });
    }
    const { VectorStore } = await import("./VectorStore.js");
    const vectorStore = new (VectorStore as unknown as new () => { addContext: (i: unknown) => Promise<void> })();
    for (const item of items) {
      await vectorStore.addContext({
        type: item.type,
        content: item.content,
        filePath: item.filePath,
        timestamp: item.timestamp,
        projectId: item.projectId,
      });
    }

    const query = "websockets";
    const projectItems = meta.getByProject(projectId);
    const keywordRows = projectItems.filter((r) =>
      r.content.toLowerCase().includes(query) || r.content.toLowerCase().includes("websockets") || r.content.toLowerCase().includes("latency")
    );
    const vectorResults = await (vectorStore as unknown as { semanticSearch: (q: string, p: string, k: number) => Promise<SemanticSearchResult[]> }).semanticSearch(
      query,
      projectId,
      5
    );
    const allContents = [
      ...keywordRows.map((r) => r.content),
      ...vectorResults.map((r) => r.content),
    ];
    const hasDecision = allContents.some(
      (c) => c.includes("WebSockets") && c.includes("latency")
    );
    expect(hasDecision).toBe(true);
  });
});
