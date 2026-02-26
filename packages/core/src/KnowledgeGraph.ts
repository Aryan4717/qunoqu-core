/**
 * Lightweight knowledge graph: nodes (file, function, decision, module) and edges (imports, depends_on, calls, etc.).
 * Stored as JSON at ~/.qunoqu/graph.json. Persists after every 10 mutations.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ContextItem } from "./types.js";

const QUNOQU_DIR = join(homedir(), ".qunoqu");
const DEFAULT_GRAPH_PATH = join(QUNOQU_DIR, "graph.json");

export type NodeType = "file" | "function" | "decision" | "module";
export type RelationType =
  | "imports"
  | "depends_on"
  | "decided_by"
  | "related_to"
  | "calls";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  projectId: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: RelationType;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface KnowledgeGraphOptions {
  graphPath?: string;
}

const PERSIST_EVERY_N_MUTATIONS = 10;

export class KnowledgeGraph {
  private path: string;
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private mutationCount = 0;

  constructor(options: KnowledgeGraphOptions = {}) {
    this.path = options.graphPath ?? DEFAULT_GRAPH_PATH;
    const dir = join(this.path, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) {
      return;
    }
    try {
      const raw = readFileSync(this.path, "utf-8");
      const data = JSON.parse(raw) as GraphData;
      this.nodes = new Map((data.nodes ?? []).map((n) => [n.id, n]));
      this.edges = data.edges ?? [];
    } catch {
      this.nodes = new Map();
      this.edges = [];
    }
  }

  private persist(): void {
    const data: GraphData = {
      nodes: Array.from(this.nodes.values()),
      edges: [...this.edges],
    };
    const dir = join(this.path, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.path, JSON.stringify(data, null, 0), "utf-8");
  }

  private afterMutation(): void {
    this.mutationCount++;
    if (this.mutationCount % PERSIST_EVERY_N_MUTATIONS === 0) {
      this.persist();
    }
  }

  addNode(node: GraphNode): void {
    if (this.nodes.has(node.id)) {
      this.nodes.set(node.id, { ...this.nodes.get(node.id)!, ...node });
    } else {
      this.nodes.set(node.id, { ...node });
    }
    this.afterMutation();
  }

  addEdge(edge: GraphEdge): void {
    const exists = this.edges.some(
      (e) =>
        e.from === edge.from && e.to === edge.to && e.relation === edge.relation
    );
    if (!exists) {
      this.edges.push({ ...edge });
      this.afterMutation();
    }
  }

  removeNode(nodeId: string): void {
    if (!this.nodes.has(nodeId)) return;
    this.nodes.delete(nodeId);
    this.edges = this.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
    this.afterMutation();
  }

  getNode(nodeId: string): GraphNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Get nodes connected to nodeId, optionally filtered by relation type.
   */
  getRelated(nodeId: string, relation?: RelationType): GraphNode[] {
    const out = new Set<string>();
    for (const e of this.edges) {
      if (e.from !== nodeId && e.to !== nodeId) continue;
      if (relation != null && e.relation !== relation) continue;
      const other = e.from === nodeId ? e.to : e.from;
      out.add(other);
    }
    return [...out]
      .map((id) => this.nodes.get(id))
      .filter((n): n is GraphNode => n != null);
  }

  /**
   * Shortest path between two nodes (BFS). Returns ordered node ids or empty array if no path.
   */
  findPath(fromId: string, toId: string): string[] {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return [];
    if (fromId === toId) return [fromId];

    const queue: string[] = [fromId];
    const visited = new Set<string>([fromId]);
    const parent = new Map<string, string>();

    while (queue.length > 0) {
      const u = queue.shift()!;
      for (const e of this.edges) {
        const next =
          e.from === u ? e.to : e.to === u ? e.from : null;
        if (next == null || visited.has(next)) continue;
        visited.add(next);
        parent.set(next, u);
        if (next === toId) {
          const path: string[] = [];
          let cur: string | undefined = toId;
          while (cur != null) {
            path.unshift(cur);
            cur = parent.get(cur);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [];
  }

  /**
   * Top 10 most connected nodes (by degree) for the project.
   */
  getProjectSummary(projectId: string): GraphNode[] {
    const degree = new Map<string, number>();
    for (const n of this.nodes.values()) {
      if (n.projectId !== projectId) continue;
      degree.set(n.id, 0);
    }
    for (const e of this.edges) {
      const fromIn = this.nodes.get(e.from)?.projectId === projectId;
      const toIn = this.nodes.get(e.to)?.projectId === projectId;
      if (fromIn) degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      if (toIn) degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    return [...this.nodes.values()]
      .filter((n) => n.projectId === projectId)
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, 10);
  }

  /**
   * Build nodes and edges from context items. Creates "imports" edges from file→module;
   * optionally pass file content (per filePath) to detect "calls" (file → function) where function name appears as "name(".
   */
  extractFromContextItems(
    items: ContextItem[],
    options?: { fileContent?: string; fileContents?: Record<string, string> }
  ): void {
    const FILE_KEY_SEP = "\0";
    const byFile = new Map<string, ContextItem[]>();
    for (const item of items) {
      const key = `${item.projectId}${FILE_KEY_SEP}${item.filePath}`;
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key)!.push(item);
    }

    for (const [key, fileItems] of byFile) {
      const sepIdx = key.indexOf(FILE_KEY_SEP);
      const projectId = key.slice(0, sepIdx);
      const filePath = key.slice(sepIdx + FILE_KEY_SEP.length);
      const fileId = `file:${projectId}:${filePath}`;
      const fileNode: GraphNode = {
        id: fileId,
        type: "file",
        label: filePath,
        projectId,
        metadata: {},
      };
      this.addNode(fileNode);

      const functionNames = new Set<string>();
      for (const item of fileItems) {
        if (item.type === "function" || item.type === "class") {
          functionNames.add(item.content);
          const fnId = `fn:${projectId}:${filePath}:${item.content}`;
          this.addNode({
            id: fnId,
            type: "function",
            label: item.content,
            projectId,
            metadata: { filePath },
          });
          this.addEdge({
            from: fileId,
            to: fnId,
            relation: "depends_on",
            weight: 1,
          });
        }
        if (item.type === "import") {
          const modId = `module:${projectId}:${item.content}`;
          this.addNode({
            id: modId,
            type: "module",
            label: item.content,
            projectId,
            metadata: {},
          });
          this.addEdge({
            from: fileId,
            to: modId,
            relation: "imports",
            weight: 1,
          });
        }
        if (item.type === "architecture-decision") {
          const decId = `decision:${projectId}:${filePath}:${Date.now()}:${item.content.slice(0, 50)}`;
          this.addNode({
            id: decId,
            type: "decision",
            label: item.content.slice(0, 80),
            projectId,
            metadata: { filePath },
          });
          this.addEdge({
            from: fileId,
            to: decId,
            relation: "decided_by",
            weight: 1,
          });
        }
      }

      const content =
        options?.fileContents?.[filePath] ?? options?.fileContent;
      if (content && functionNames.size > 0) {
        for (const name of functionNames) {
          const callRe = new RegExp(
            `\\b${escapeRe(name)}\\s*\\(`,
            "g"
          );
          if (callRe.test(content)) {
            const fnId = `fn:${projectId}:${filePath}:${name}`;
            this.addEdge({
              from: fileId,
              to: fnId,
              relation: "calls",
              weight: 1,
            });
          }
        }
      }
    }
  }

  /** Force write graph to disk (e.g. after batch of extractions). */
  save(): void {
    this.persist();
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
