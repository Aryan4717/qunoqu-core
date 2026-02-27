/**
 * REST API server for non-MCP tool integration (ChatGPT custom actions, DeepSeek).
 * Express on localhost:7384. Auth via Bearer token in ~/.qunoqu/api-token.
 */

import express, { type Request, type Response } from "express";
import type { Server as HttpServerInstance } from "http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { MetadataStore } from "./MetadataStore.js";
import { VectorStore } from "./VectorStore.js";
import { KnowledgeGraph } from "./KnowledgeGraph.js";
import type { ContextItemRow } from "./metadataTypes.js";
import type { SemanticSearchResult } from "./VectorStore.js";
import type { GraphNode } from "./KnowledgeGraph.js";

const QUNOQU_DIR = join(homedir(), ".qunoqu");
const DEFAULT_API_TOKEN_PATH = join(QUNOQU_DIR, "api-token");
/** Default path for pid file used by CLI "server stop". */
export const DEFAULT_API_PID_PATH = join(QUNOQU_DIR, "qunoqu-api.pid");
const DEFAULT_PORT = 7384;
const PACKAGE_VERSION = "0.0.0";

export interface ServerOptions {
  port?: number;
  dbPath?: string;
  chromaPath?: string;
  ollamaBaseUrl?: string;
  graphPath?: string;
  apiTokenPath?: string;
}

/** API context item shape for GET /context */
export interface ContextItemApi {
  id: string;
  project_id: string;
  type: string;
  content: string;
  file_path: string | null;
  created_at: number;
}

function rowToContextItemApi(row: ContextItemRow): ContextItemApi {
  return {
    id: row.id,
    project_id: row.project_id,
    type: row.type,
    content: row.content,
    file_path: row.file_path,
    created_at: row.created_at,
  };
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

/**
 * Ensure ~/.qunoqu/api-token exists; create with random token if not.
 * Returns the token.
 */
export function ensureApiToken(tokenPath: string = DEFAULT_API_TOKEN_PATH): string {
  const dir = join(tokenPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, "utf-8").trim();
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, token, "utf-8");
  return token;
}

export function getApiTokenPath(options: ServerOptions = {}): string {
  return options.apiTokenPath ?? DEFAULT_API_TOKEN_PATH;
}

export interface CreateAppOptions {
  dbPath?: string;
  chromaPath?: string;
  ollamaBaseUrl?: string;
  graphPath?: string;
  apiTokenPath?: string;
  /** If true, do not require Bearer auth (for testing). */
  disableAuth?: boolean;
}

/**
 * Create Express app with REST routes. Does not listen.
 * Use for testing or for mounting in another app.
 */
export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.use(express.json());

  const tokenPath = options.apiTokenPath ?? DEFAULT_API_TOKEN_PATH;
  let resolvedToken: string | null = null;

  const authMiddleware = (req: Request, res: Response, next: () => void) => {
    if (options.disableAuth) {
      next();
      return;
    }
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header. Use Bearer <token>." });
      return;
    }
    const token = auth.slice(7);
    if (resolvedToken === null) {
      resolvedToken = existsSync(tokenPath) ? readFileSync(tokenPath, "utf-8").trim() : "";
    }
    if (!resolvedToken || token !== resolvedToken) {
      res.status(401).json({ error: "Invalid token." });
      return;
    }
    next();
  };

  app.use(authMiddleware);

  // Lazy stores (same pattern as QunoqMCPServer)
  let metadataStore: MetadataStore | null = null;
  let vectorStore: VectorStore | null | undefined = undefined;
  let knowledgeGraph: KnowledgeGraph | null = null;

  function getMeta(): MetadataStore {
    if (!metadataStore) {
      metadataStore = new MetadataStore({ dbPath: options.dbPath });
    }
    return metadataStore;
  }

  function getVector(): VectorStore | null {
    if (vectorStore === undefined) {
      try {
        vectorStore = new VectorStore({
          chromaPath: options.chromaPath,
          ollamaBaseUrl: options.ollamaBaseUrl,
        });
      } catch {
        vectorStore = null;
      }
    }
    return vectorStore ?? null;
  }

  function getKg(): KnowledgeGraph {
    if (!knowledgeGraph) {
      knowledgeGraph = new KnowledgeGraph({ graphPath: options.graphPath });
    }
    return knowledgeGraph;
  }

  async function getOllamaStatus(): Promise<string> {
    const base = options.ollamaBaseUrl ?? "http://localhost:11434";
    try {
      const res = await fetch(`${base}/api/tags`, { method: "GET" });
      return res.ok ? "ok" : "unavailable";
    } catch {
      return "unavailable";
    }
  }

  // (1) GET /context?q= & projectId= & topK=
  app.get("/context", async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) ?? "";
      const projectId = (req.query.projectId as string) ?? undefined;
      const topK = Math.min(20, Math.max(1, parseInt(String(req.query.topK ?? "5"), 10) || 5));

      const meta = getMeta();
      const keywordRows = meta.keywordSearch(q, { projectId, limit: topK * 2 });

      let vectorResults: SemanticSearchResult[] = [];
      if (projectId) {
        const vec = getVector();
        if (vec) {
          try {
            vectorResults = await vec.semanticSearch(q || "recent", projectId, topK);
          } catch {
            // fallback: keyword only
          }
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
      const items = deduped.slice(0, topK).map(rowToContextItemApi);

      res.json({ items, query: q, projectId: projectId ?? null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // (2) POST /decision
  app.post("/decision", (req: Request, res: Response) => {
    try {
      const { title, rationale, projectId } = req.body ?? {};
      if (!title || !rationale || !projectId) {
        res.status(400).json({ error: "Body must include title, rationale, and projectId." });
        return;
      }
      const meta = getMeta();
      const id = meta.insertDecision({
        project_id: projectId,
        title: String(title),
        rationale: String(rationale),
      });
      const kg = getKg();
      const nodeId = `decision:${projectId}:${id}`;
      kg.addNode({
        id: nodeId,
        type: "decision",
        label: String(title).slice(0, 80),
        projectId,
        metadata: { rationale: String(rationale).slice(0, 200) },
      });
      kg.save();
      res.json({ id, saved: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // (3) GET /summary/:projectId
  app.get("/summary/:projectId", (req: Request, res: Response) => {
    try {
      const projectId = req.params.projectId;
      if (!projectId) {
        res.status(400).json({ error: "projectId required." });
        return;
      }
      const meta = getMeta();
      const kg = getKg();
      const recentItems = meta.getByProject(projectId).slice(0, 10).map(rowToContextItemApi);
      const decisions = meta.getDecisions(projectId).slice(0, 10);
      const graphSummary: GraphNode[] = kg.getProjectSummary(projectId);
      const allItems = meta.getByProject(projectId);
      const stats = {
        contextCount: allItems.length,
        decisionCount: meta.getDecisions(projectId).length,
        graphNodeCount: graphSummary.length,
      };
      res.json({
        recentItems,
        decisions,
        graphSummary,
        stats,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // (4) GET /health
  app.get("/health", async (_req: Request, res: Response) => {
    try {
      const meta = getMeta();
      const projects = meta.listProjects();
      const memoriesCount = projects.reduce((acc, p) => acc + p.context_count, 0);
      const ollamaStatus = await getOllamaStatus();
      res.json({
        status: "ok",
        version: PACKAGE_VERSION,
        memoriesCount,
        ollamaStatus,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ status: "error", error: message });
    }
  });

  // GET /openapi.json
  app.get("/openapi.json", (_req: Request, res: Response) => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Qunoqu REST API", version: PACKAGE_VERSION },
      servers: [{ url: "http://localhost:7384", description: "Local" }],
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "token" },
        },
      },
      paths: {
        "/context": {
          get: {
            summary: "Search context",
            parameters: [
              { name: "q", in: "query", schema: { type: "string" }, description: "Search query" },
              { name: "projectId", in: "query", schema: { type: "string" }, description: "Project ID" },
              { name: "topK", in: "query", schema: { type: "integer", default: 5 }, description: "Max items" },
            ],
            responses: { 200: { description: "items, query, projectId" } },
          },
        },
        "/decision": {
          post: {
            summary: "Save decision",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["title", "rationale", "projectId"],
                    properties: { title: { type: "string" }, rationale: { type: "string" }, projectId: { type: "string" } },
                  },
                },
              },
            },
            responses: { 200: { description: "id, saved: true" } },
          },
        },
        "/summary/{projectId}": {
          get: {
            summary: "Project summary",
            parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "string" } }],
            responses: { 200: { description: "recentItems, decisions, graphSummary, stats" } },
          },
        },
        "/health": {
          get: {
            summary: "Health",
            responses: { 200: { description: "status, version, memoriesCount, ollamaStatus" } },
          },
        },
      },
    };
    res.json(spec);
  });

  return app;
}

/**
 * Start the REST API server. Returns the HTTP server and the port.
 */
export function startServer(options: ServerOptions = {}): Promise<{ server: HttpServerInstance; port: number }> {
  const port = options.port ?? (parseInt(process.env.QUNOQU_API_PORT ?? "", 10) || DEFAULT_PORT);
  ensureApiToken(options.apiTokenPath ?? DEFAULT_API_TOKEN_PATH);
  const app = createApp({
    dbPath: options.dbPath,
    chromaPath: options.chromaPath,
    ollamaBaseUrl: options.ollamaBaseUrl,
    graphPath: options.graphPath,
    apiTokenPath: options.apiTokenPath,
  });
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}
