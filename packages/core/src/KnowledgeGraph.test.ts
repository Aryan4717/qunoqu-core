import { describe, it, expect, beforeEach } from "vitest";
import { KnowledgeGraph } from "./KnowledgeGraph.js";
import type { ContextItem } from "./types.js";
import { join } from "path";
import { tmpdir } from "os";
import { readFileSync, existsSync } from "fs";

const TEST_DIR = join(tmpdir(), "qunoqu-kg-test-" + Date.now());

describe("KnowledgeGraph", () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = new KnowledgeGraph({
      graphPath: join(TEST_DIR, `graph-${Math.random().toString(36).slice(2)}.json`),
    });
  });

  it("addNode and getNode", () => {
    graph.addNode({
      id: "n1",
      type: "file",
      label: "foo.ts",
      projectId: "p1",
      metadata: {},
    });
    expect(graph.getNode("n1")).toEqual({
      id: "n1",
      type: "file",
      label: "foo.ts",
      projectId: "p1",
      metadata: {},
    });
  });

  it("addEdge and getRelated", () => {
    graph.addNode({
      id: "a",
      type: "file",
      label: "a",
      projectId: "p1",
      metadata: {},
    });
    graph.addNode({
      id: "b",
      type: "module",
      label: "b",
      projectId: "p1",
      metadata: {},
    });
    graph.addEdge({ from: "a", to: "b", relation: "imports", weight: 1 });
    const related = graph.getRelated("a");
    expect(related).toHaveLength(1);
    expect(related[0].id).toBe("b");
    expect(graph.getRelated("a", "imports")).toHaveLength(1);
    expect(graph.getRelated("a", "calls")).toHaveLength(0);
  });

  it("removeNode deletes node and incident edges", () => {
    graph.addNode({
      id: "x",
      type: "file",
      label: "x",
      projectId: "p1",
      metadata: {},
    });
    graph.addNode({
      id: "y",
      type: "file",
      label: "y",
      projectId: "p1",
      metadata: {},
    });
    graph.addEdge({ from: "x", to: "y", relation: "depends_on", weight: 1 });
    graph.removeNode("x");
    expect(graph.getNode("x")).toBeUndefined();
    expect(graph.getRelated("y")).toHaveLength(0);
  });

  it("findPath returns shortest path (BFS)", () => {
    graph.addNode({
      id: "1",
      type: "file",
      label: "1",
      projectId: "p1",
      metadata: {},
    });
    graph.addNode({
      id: "2",
      type: "file",
      label: "2",
      projectId: "p1",
      metadata: {},
    });
    graph.addNode({
      id: "3",
      type: "file",
      label: "3",
      projectId: "p1",
      metadata: {},
    });
    graph.addEdge({ from: "1", to: "2", relation: "imports", weight: 1 });
    graph.addEdge({ from: "2", to: "3", relation: "imports", weight: 1 });
    expect(graph.findPath("1", "3")).toEqual(["1", "2", "3"]);
    expect(graph.findPath("1", "1")).toEqual(["1"]);
    expect(graph.findPath("1", "nonexistent")).toEqual([]);
  });

  it("getProjectSummary returns top 10 most connected nodes", () => {
    for (let i = 0; i < 5; i++) {
      graph.addNode({
        id: `n${i}`,
        type: "file",
        label: `n${i}`,
        projectId: "p1",
        metadata: {},
      });
    }
    graph.addEdge({ from: "n0", to: "n1", relation: "imports", weight: 1 });
    graph.addEdge({ from: "n0", to: "n2", relation: "imports", weight: 1 });
    graph.addEdge({ from: "n0", to: "n3", relation: "imports", weight: 1 });
    graph.addEdge({ from: "n1", to: "n2", relation: "imports", weight: 1 });
    const summary = graph.getProjectSummary("p1");
    expect(summary.length).toBeLessThanOrEqual(10);
    expect(summary[0].id).toBe("n0");
    expect(summary[1].id).toBe("n1");
  });

  it("extractFromContextItems creates file, function, module nodes and imports edges", () => {
    const items: ContextItem[] = [
      {
        type: "function",
        content: "bar",
        filePath: "/proj/src/foo.ts",
        timestamp: 1,
        projectId: "proj1",
      },
      {
        type: "import",
        content: "lodash",
        filePath: "/proj/src/foo.ts",
        timestamp: 1,
        projectId: "proj1",
      },
    ];
    graph.extractFromContextItems(items);
    const fileId = "file:proj1:/proj/src/foo.ts";
    expect(graph.getNode(fileId)).toBeDefined();
    expect(graph.getNode("fn:proj1:/proj/src/foo.ts:bar")).toBeDefined();
    expect(graph.getNode("module:proj1:lodash")).toBeDefined();
    const related = graph.getRelated(fileId);
    expect(related.length).toBeGreaterThanOrEqual(2);
    const imports = graph.getRelated(fileId, "imports");
    expect(imports.some((n) => n.label === "lodash")).toBe(true);
  });

  it("extractFromContextItems with fileContent adds calls edges", () => {
    const items: ContextItem[] = [
      {
        type: "function",
        content: "helper",
        filePath: "/proj/a.ts",
        timestamp: 1,
        projectId: "proj1",
      },
    ];
    graph.extractFromContextItems(items, {
      fileContent: "const x = helper();",
    });
    const fileId = "file:proj1:/proj/a.ts";
    const calls = graph.getRelated(fileId, "calls");
    expect(calls.length).toBe(1);
    expect(calls[0].label).toBe("helper");
  });

  it("persists after every 10 mutations", () => {
    const path = join(TEST_DIR, "persist-test.json");
    const g = new KnowledgeGraph({ graphPath: path });
    for (let i = 0; i < 9; i++) {
      g.addNode({
        id: `n${i}`,
        type: "file",
        label: `n${i}`,
        projectId: "p1",
        metadata: {},
      });
    }
    expect(existsSync(path)).toBe(false);
    g.addNode({
      id: "n9",
      type: "file",
      label: "n9",
      projectId: "p1",
      metadata: {},
    });
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, "utf-8"));
    expect(data.nodes.length).toBe(10);
  });
});
