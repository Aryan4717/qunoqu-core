/**
 * MCP server exposing the qunoqu memory layer to AI tools (Claude Desktop, Cursor).
 * Transport: stdio. Tools: recall_context, save_decision, get_project_summary.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { MetadataStore } from "./MetadataStore.js";
import type { VectorStore } from "./VectorStore.js";
import type { KnowledgeGraph } from "./KnowledgeGraph.js";
import { MetadataStore as MetadataStoreCtor } from "./MetadataStore.js";
import { VectorStore as VectorStoreCtor } from "./VectorStore.js";
import { KnowledgeGraph as KnowledgeGraphCtor } from "./KnowledgeGraph.js";
import type { SemanticSearchResult } from "./VectorStore.js";

export interface QunoqMCPServerOptions {
  dbPath?: string;
  chromaPath?: string;
  ollamaBaseUrl?: string;
  graphPath?: string;
}

const DEFAULT_TOP_K = 5;

function formatContextItem(
  item: { content: string; file_path?: string | null; type?: string; created_at?: number },
  source: string
): string {
  const file = item.file_path ? ` (file: ${item.file_path})` : "";
  const type = item.type ? ` [${item.type}]` : "";
  const ts = item.created_at ? ` @${new Date(item.created_at).toISOString()}` : "";
  return `[${source}${file}${type}${ts}]\n${item.content}`;
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

export class QunoqMCPServer {
  private options: QunoqMCPServerOptions;
  private metadataStore: MetadataStore | null = null;
  private vectorStore: VectorStore | null | undefined = undefined;
  private knowledgeGraph: KnowledgeGraph | null = null;
  private mcp: McpServer;

  constructor(options: QunoqMCPServerOptions = {}) {
    this.options = options;
    this.mcp = new McpServer(
      { name: "qunoqu", version: "1.0.0" },
      { capabilities: { tools: { listChanged: true } } }
    );
    this.registerTools();
  }

  private getMetadataStore(): MetadataStore {
    if (!this.metadataStore) {
      this.metadataStore = new MetadataStoreCtor({ dbPath: this.options.dbPath });
    }
    return this.metadataStore;
  }

  private getVectorStore(): VectorStore | null {
    if (this.vectorStore === undefined) {
      try {
        this.vectorStore = new VectorStoreCtor({
          chromaPath: this.options.chromaPath,
          ollamaBaseUrl: this.options.ollamaBaseUrl,
        });
      } catch {
        this.vectorStore = null;
      }
    }
    return this.vectorStore ?? null;
  }

  private getKnowledgeGraph(): KnowledgeGraph {
    if (!this.knowledgeGraph) {
      this.knowledgeGraph = new KnowledgeGraphCtor({ graphPath: this.options.graphPath });
    }
    return this.knowledgeGraph;
  }

  private registerTools(): void {
    this.mcp.registerTool(
      "recall_context",
      {
        description:
          "Hybrid search over project memory: semantic (vector) + keyword (SQLite). Returns top relevant context items with source info. Use when the AI needs project context, decisions, or past terminal/output.",
        inputSchema: z.object({
          query: z.string().describe("Search query (natural language or keywords)"),
          projectId: z.string().optional().describe("Project ID to scope search; if omitted, keyword search only"),
          topK: z.number().int().min(1).max(20).optional().describe("Max number of items to return (default 5)"),
        }),
      },
      async (args) => {
        try {
          const topK = args.topK ?? DEFAULT_TOP_K;
          const projectId = args.projectId ?? undefined;
          const meta = this.getMetadataStore();

          const keywordRows = meta.keywordSearch(args.query, {
            projectId,
            limit: topK * 2,
          });

          let vectorResults: SemanticSearchResult[] = [];
          if (projectId) {
            const vec = this.getVectorStore();
            if (vec) {
              try {
                vectorResults = await vec.semanticSearch(args.query, projectId, topK);
              } catch {
                // Chroma/Ollama unavailable; continue with keyword only
              }
            }
          }

          const combined: Array<{ content: string; file_path: string | null; type: string; created_at: number; source: string }> = [];
          for (const r of vectorResults) {
            combined.push({
              content: r.content,
              file_path: r.metadata.filePath,
              type: r.metadata.type,
              created_at: r.metadata.timestamp,
              source: "vector",
            });
          }
          for (const r of keywordRows) {
            combined.push({
              content: r.content,
              file_path: r.file_path,
              type: r.type,
              created_at: r.created_at,
              source: "keyword",
            });
          }

          const deduped = dedupeByContent(combined);
          const top = deduped.slice(0, topK);
          const text =
            top.length === 0
              ? "No relevant context found for this query."
              : top.map((item) => formatContextItem(item, item.source)).join("\n\n---\n\n");

          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Recall failed: ${message}. Check that storage is available.` }],
            isError: true,
          };
        }
      }
    );

    this.mcp.registerTool(
      "save_decision",
      {
        description: "Save a decision to the project's decisions table and knowledge graph.",
        inputSchema: z.object({
          title: z.string().describe("Short title of the decision"),
          rationale: z.string().describe("Rationale or explanation"),
          projectId: z.string().describe("Project ID"),
        }),
      },
      async (args) => {
        try {
          const meta = this.getMetadataStore();
          const id = meta.insertDecision({
            project_id: args.projectId,
            title: args.title,
            rationale: args.rationale,
          });
          const kg = this.getKnowledgeGraph();
          const nodeId = `decision:${args.projectId}:${id}`;
          kg.addNode({
            id: nodeId,
            type: "decision",
            label: args.title.slice(0, 80),
            projectId: args.projectId,
            metadata: { rationale: args.rationale.slice(0, 200) },
          });
          kg.save();
          return {
            content: [
              {
                type: "text" as const,
                text: `Saved decision: "${args.title}" (id: ${id}). Added to decisions table and knowledge graph.`,
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Save decision failed: ${message}. Check that storage is available.` }],
            isError: true,
          };
        }
      }
    );

    this.mcp.registerTool(
      "get_project_summary",
      {
        description:
          "Returns a project summary: last 10 context items, top decisions, knowledge graph summary, and active file list.",
        inputSchema: z.object({
          projectId: z.string().describe("Project ID"),
        }),
      },
      async (args) => {
        try {
          const meta = this.getMetadataStore();
          const kg = this.getKnowledgeGraph();
          const projectId = args.projectId;

          const contextItems = meta.getByProject(projectId).slice(0, 10);
          const decisions = meta.getDecisions(projectId).slice(0, 10);
          const kgNodes = kg.getProjectSummary(projectId);
          const filePaths = [...new Set(contextItems.map((c) => c.file_path).filter(Boolean))] as string[];

          const sections: string[] = [];
          sections.push("## Last 10 context items");
          if (contextItems.length === 0) sections.push("(none)");
          else contextItems.forEach((c) => sections.push(formatContextItem(c, "context")));

          sections.push("\n## Top decisions");
          if (decisions.length === 0) sections.push("(none)");
          else
            decisions.forEach((d) =>
              sections.push(`- **${d.title}** (${new Date(d.decided_at).toISOString()})\n  ${d.rationale.slice(0, 200)}${d.rationale.length > 200 ? "…" : ""}`)
            );

          sections.push("\n## Knowledge graph (top nodes by connectivity)");
          if (kgNodes.length === 0) sections.push("(none)");
          else kgNodes.forEach((n) => sections.push(`- [${n.type}] ${n.label} (id: ${n.id})`));

          sections.push("\n## Active files (from context)");
          if (filePaths.length === 0) sections.push("(none)");
          else filePaths.forEach((f) => sections.push(`- ${f}`));

          const text = sections.join("\n\n");
          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Project summary failed: ${message}. Check that storage is available.` }],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * Connect to stdio transport and start the server (for Claude Desktop).
   */
  async connect(transport?: InstanceType<typeof StdioServerTransport>): Promise<void> {
    const t = transport ?? new StdioServerTransport();
    await this.mcp.connect(t);
  }

  /**
   * Close the server and any storage connections.
   */
  async close(): Promise<void> {
    await this.mcp.close();
    if (this.metadataStore && "close" in this.metadataStore) {
      (this.metadataStore as MetadataStore & { close(): void }).close();
    }
  }

  getServer(): McpServer {
    return this.mcp;
  }
}

/**
 * Claude Desktop config snippet to enable the qunoqu MCP server.
 * Add this under the "mcpServers" key in your Claude Desktop config.
 *
 * Config file locations:
 * - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
 * - Windows: %APPDATA%\Claude\claude_desktop_config.json
 *
 * Replace /ABSOLUTE/PATH/TO/qunoqu-core with your repo path, or use npx:
 *   "args": ["node_modules/@qunoqu/core/dist/run-mcp.js"] (if installed as dependency)
 */
export const CLAUDE_DESKTOP_MCP_CONFIG = {
  qunoqu: {
    command: "node",
    args: ["/ABSOLUTE/PATH/TO/qunoqu-core/packages/core/dist/run-mcp.js"],
    env: {},
  },
};
