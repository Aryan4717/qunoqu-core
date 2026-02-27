/**
 * REST API server for non-MCP tool integration (ChatGPT custom actions, DeepSeek).
 * Express on localhost:7384. Auth via Bearer token in ~/.qunoqu/api-token.
 */

import express, { type Request, type Response } from "express";
import { MetadataStore } from "./MetadataStore.js";
import { VectorStore } from "./VectorStore.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";
import type { SemanticSearchResult } from "./VectorStore.js";
import type { ContextItemRow, DecisionRow } from "./metadataTypes.js";
import type { GraphNode } from "./KnowledgeGraph.js";
import { getOrCreateApiToken } from "./restApiToken.js";

const DEFAULT_TOP_K = 5;
const API_VERSION = "1.0.0";

export interface RestApiServerOptions {
  port?: number;
  dbPath?: string;
  chromaPath?: string;
  ollamaBaseUrl?: string;
  graphPath?: string;
  /** If set, use this token instead of reading from file (e.g. for tests). */
  token?: string | null;
}

function dedupeByContent<T extends { content: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.content.trim().slice(0, 500);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Context item shape for REST responses. */
export interface ContextItemResponse {
  id: string;
  project_id: string;
  type: string;
  content: string;
  file_path: string | null;
  created_at: number;
}

/** Summary response for GET /summary/:projectId */
export interface SummaryResponse {
  recentItems: ContextItemResponse[];
  decisions: Array<{ id: string; project_id: string; title: string; rationale: string; decided_at: number }>;
  graphSummary: Array<{ id: string; type: string; label: string; projectId: string }>;
  stats: { totalContextItems: number; totalDecisions: number };
}

/** Health response */
export interface HealthResponse {
  status: "ok";
  version: string;
  memoriesCount: number;
  ollamaStatus: "ok" | "unavailable";
}

export function createRestApiServer(options: RestApiServerOptions = {}) {
  const port = options.port ?? 7384;
  const metadataStore = new MetadataStore({ dbPath: options.dbPath });
  let vectorStore: VectorStore | null = null;
  let knowledgeGraph: KnowledgeGraph | null = null;

  try {
    vectorStore = new VectorStore({
      chromaPath: options.chromaPath,
      ollamaBaseUrl: options.ollamaBaseUrl,
    });
  } catch {
    vectorStore = null;
  }
  knowledgeGraph = new KnowledgeGraph({ graphPath: options.graphPath });

  const token = options.token !== undefined ? options.token : getOrCreateApiToken();
  if (!token) throw new Error("API token is required");

  const app = express();
  app.use(express.json());

  function authMiddleware(req: Request, res: Response, next: () => void) {
    const auth = req.headers.authorization;
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    if (!bearer || bearer !== token) {
      res.status(401).json({ error: "Unauthorized", message: "Missing or invalid Bearer token" });
      return;
    }
    next();
  }

  app.use((req, res, next) => {
    if (req.path === "/health" || req.path === "/openapi.json") {
      next();
      return;
    }
    authMiddleware(req, res, next);
  });

  function toContextItemResponse(row: ContextItemRow): ContextItemResponse {
    return {
      id: row.id,
      project_id: row.project_id,
      type: row.type,
      content: row.content,
      file_path: row.file_path,
      created_at: row.created_at,
    };
  }

  // GET /context?q=query&projectId=id&topK=n
  app.get("/context", async (req: Request, res: Response) => {
    try {
      const query = (req.query.q as string) ?? "";
      const projectId = (req.query.projectId as string) || undefined;
      const topK = Math.min(20, Math.max(1, parseInt(String(req.query.topK), 10) || DEFAULT_TOP_K));

      const keywordRows = metadataStore.keywordSearch(query, { projectId, limit: topK * 2 });
      let vectorResults: SemanticSearchResult[] = [];
      if (projectId && vectorStore) {
        try {
          vectorResults = await vectorStore.semanticSearch(query || "recent", projectId, topK);
        } catch {
          // ignore
        }
      }

      const combined: Array<ContextItemRow & { source?: string }> = [];
      for (const r of vectorResults) {
        combined.push({
          id: r.id,
          project_id: r.metadata.projectId,
          type: r.metadata.type as ContextItemRow["type"],
          content: r.content,
          file_path: r.metadata.filePath,
          embedding_id: null,
          tags: [],
          created_at: r.metadata.timestamp,
          is_stale: false,
        });
      }
      for (const r of keywordRows) {
        combined.push({ ...r });
      }
      const deduped = dedupeByContent(combined);
      const items = deduped.slice(0, topK).map(toContextItemResponse);
      res.json({ items, query, projectId: projectId ?? null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Recall failed", message });
    }
  });

  // POST /decision
  app.post("/decision", (req: Request, res: Response) => {
    try {
      const { title, rationale, projectId } = req.body ?? {};
      if (!title || !rationale) {
        res.status(400).json({ error: "Bad request", message: "title and rationale are required" });
        return;
      }
      if (!projectId) {
        res.status(400).json({ error: "Bad request", message: "projectId is required" });
        return;
      }
      const id = metadataStore.insertDecision({ project_id: projectId, title, rationale });
      if (knowledgeGraph) {
        const nodeId = `decision:${projectId}:${id}`;
        knowledgeGraph.addNode({
          id: nodeId,
          type: "decision",
          label: String(title).slice(0, 80),
          projectId,
          metadata: { rationale: String(rationale).slice(0, 200) },
        });
        knowledgeGraph.save();
      }
      res.json({ id, saved: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Save decision failed", message });
    }
  });

  // GET /summary/:projectId
  app.get("/summary/:projectId", (req: Request, res: Response) => {
    try {
      const projectId = req.params.projectId;
      if (!projectId) {
        res.status(400).json({ error: "Bad request", message: "projectId is required" });
        return;
      }
      const contextItems = metadataStore.getByProject(projectId).slice(0, 10);
      const decisions = metadataStore.getDecisions(projectId).slice(0, 10);
      const kgNodes: GraphNode[] = knowledgeGraph ? knowledgeGraph.getProjectSummary(projectId) : [];
      const allForProject = metadataStore.getByProject(projectId);
      const decisionRows = metadataStore.getDecisions(projectId);
      res.json({
        recentItems: contextItems.map(toContextItemResponse),
        decisions: decisions.map((d: DecisionRow) => ({
          id: d.id,
          project_id: d.project_id,
          title: d.title,
          rationale: d.rationale,
          decided_at: d.decided_at,
        })),
        graphSummary: kgNodes.map((n) => ({ id: n.id, type: n.type, label: n.label, projectId: n.projectId })),
        stats: {
          totalContextItems: allForProject.length,
          totalDecisions: decisionRows.length,
        },
      } satisfies SummaryResponse);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "Project summary failed", message });
    }
  });

  // GET /health
  app.get("/health", async (_req: Request, res: Response) => {
    const projects = metadataStore.listProjects();
    const memoriesCount = projects.reduce((s, p) => s + p.context_count, 0);
    let ollamaStatus: "ok" | "unavailable" = "unavailable";
    try {
      const r = await fetch(`${options.ollamaBaseUrl ?? "http://localhost:11434"}/api/tags`, { method: "GET" });
      ollamaStatus = r.ok ? "ok" : "unavailable";
    } catch {
      // keep unavailable
    }
    res.json({ status: "ok", version: API_VERSION, memoriesCount, ollamaStatus } satisfies HealthResponse);
  });

  // GET /openapi.json
  const openApiSpec = buildOpenApiSpec(port);
  app.get("/openapi.json", (_req: Request, res: Response) => {
    res.json(openApiSpec);
  });

  const server = app.listen(port);
  return {
    app,
    server,
    port,
    close: () => {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => {
          metadataStore.close();
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

function buildOpenApiSpec(port: number): Record<string, unknown> {
  return {
    openapi: "3.0.0",
    info: { title: "Qunoqu API", version: API_VERSION, description: "REST API for Qunoqu developer memory (ChatGPT/DeepSeek)." },
    servers: [{ url: `http://localhost:${port}`, description: "Local" }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "token", description: "Token from ~/.qunoqu/api-token" },
      },
      schemas: {
        ContextItem: {
          type: "object",
          properties: { id: { type: "string" }, project_id: { type: "string" }, type: { type: "string" }, content: { type: "string" }, file_path: { type: "string", nullable: true }, created_at: { type: "number" } },
        },
        Decision: {
          type: "object",
          properties: { id: { type: "string" }, title: { type: "string" }, rationale: { type: "string" }, projectId: { type: "string" } },
        },
      },
    },
    paths: {
      "/context": {
        get: {
          summary: "Hybrid search over project memory",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" }, description: "Search query" },
            { name: "projectId", in: "query", schema: { type: "string" }, description: "Project ID" },
            { name: "topK", in: "query", schema: { type: "integer", default: 5 }, description: "Max items (1-20)" },
          ],
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/ContextItem" } }, query: { type: "string" }, projectId: { type: "string", nullable: true } } } } } }, 401: { description: "Unauthorized" } },
        },
      },
      "/decision": {
        post: {
          summary: "Save a decision",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["title", "rationale", "projectId"], properties: { title: { type: "string" }, rationale: { type: "string" }, projectId: { type: "string" } } } } } },
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, saved: { type: "boolean" } } } } } }, 400: { description: "Bad request" }, 401: { description: "Unauthorized" } },
        },
      },
      "/summary/{projectId}": {
        get: {
          summary: "Get project summary",
          parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", properties: { recentItems: { type: "array" }, decisions: { type: "array" }, graphSummary: { type: "array" }, stats: { type: "object" } } } } } }, 401: { description: "Unauthorized" } },
        },
      },
      "/health": {
        get: {
          summary: "Health check",
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, version: { type: "string" }, memoriesCount: { type: "number" }, ollamaStatus: { type: "string" } } } } } } },
        },
      },
    },
  };
}

export { getOrCreateApiToken as getOrCreateApiTokenForServer, getApiTokenPath } from "./restApiToken.js";
