import { describe, it, expect } from "vitest";
import { extractContext } from "./extractContext.js";

describe("extractContext", () => {
  const filePath = "/project/src/foo.ts";
  const projectId = "proj1";

  it("extracts function names", () => {
    const content = `
      function bar() {}
      const baz = () => {};
      function qux(a: number) { return a; }
    `;
    const items = extractContext(content, filePath, projectId);
    const fns = items.filter((i) => i.type === "function");
    expect(fns.map((i) => i.content).sort()).toEqual(["bar", "baz", "qux"]);
  });

  it("extracts class names", () => {
    const content = `
      class MyService {}
      class Helper {}
    `;
    const items = extractContext(content, filePath, projectId);
    const classes = items.filter((i) => i.type === "class");
    expect(classes.map((i) => i.content).sort()).toEqual(["Helper", "MyService"]);
  });

  it("extracts TODO and FIXME comments", () => {
    const content = `
      // TODO: refactor this
      // FIXME: memory leak
      /* TODO: remove later */
    `;
    const items = extractContext(content, filePath, projectId);
    const todos = items.filter((i) => i.type === "todo");
    expect(todos.length).toBeGreaterThanOrEqual(2);
    expect(todos.some((i) => i.content.toLowerCase().includes("refactor"))).toBe(true);
    expect(todos.some((i) => i.content.toLowerCase().includes("memory"))).toBe(true);
  });

  it("extracts import/require statements", () => {
    const content = `
      import { x } from "lodash";
      const y = require("fs");
    `;
    const items = extractContext(content, filePath, projectId);
    const imports = items.filter((i) => i.type === "import");
    expect(imports.map((i) => i.content).sort()).toEqual(["fs", "lodash"]);
  });

  it("extracts architecture-decision comments (because, decided, chose, reason)", () => {
    const content = `
      // We chose this because performance.
      /* Decided to use cache for reason of latency */
    `;
    const items = extractContext(content, filePath, projectId);
    const adr = items.filter((i) => i.type === "architecture-decision");
    expect(adr.length).toBeGreaterThanOrEqual(1);
    expect(adr.some((i) => /because|decided|chose|reason/i.test(i.content))).toBe(true);
  });

  it("sets filePath, timestamp, projectId on every item", () => {
    const content = "class X {}";
    const items = extractContext(content, filePath, projectId);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.filePath).toBe(filePath);
      expect(item.projectId).toBe(projectId);
      expect(typeof item.timestamp).toBe("number");
      expect(item.content).toBeTruthy();
      expect(["function", "class", "todo", "import", "architecture-decision"]).toContain(
        item.type
      );
    }
  });
});
