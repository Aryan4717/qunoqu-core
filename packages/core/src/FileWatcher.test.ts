import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FileWatcher, CONTEXT_CAPTURED_EVENT } from "./FileWatcher.js";

describe("FileWatcher", () => {
  let watcher: FileWatcher | null = null;

  afterEach(async () => {
    if (watcher) {
      await watcher.close();
      watcher = null;
    }
  });

  it("instantiates with default options", () => {
    watcher = new FileWatcher("/tmp");
    expect(watcher).toBeDefined();
  });

  it("accepts projectId and ignore options", () => {
    watcher = new FileWatcher("/tmp", {
      projectId: "my-project",
      ignore: ["**/skip/**"],
    });
    expect(watcher).toBeDefined();
  });

  it("emits context-captured when watching a directory and file is added", async () => {
    const tmpDirSync = mkdtempSync(join(tmpdir(), "qunoqu-watch-"));
    try {
      const w = new FileWatcher(tmpDirSync, { projectId: "test" });
      const captured: unknown[] = [];
      w.on(CONTEXT_CAPTURED_EVENT, (items: unknown) => captured.push(items));
      w.on("error", () => {});

      w.watch();

      const srcFile = join(tmpDirSync, "src.ts");
      await writeFile(
        srcFile,
        "class Foo {} function bar() {} // TODO: x\nimport { x } from 'y';"
      );

      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 1200);
        w.on(CONTEXT_CAPTURED_EVENT, () => {
          clearTimeout(t);
          resolve();
        });
      });

      await w.close();

      expect(captured.length).toBeGreaterThan(0);
      const allItems = (captured as unknown[][])?.flat?.() ?? captured;
      const items: unknown[] = Array.isArray(allItems) ? allItems : [];
      const hasType = (t: string) => items.some((i) => (i as { type?: string })?.type === t);
      expect(hasType("class")).toBe(true);
      expect(hasType("function")).toBe(true);
      expect(hasType("todo")).toBe(true);
      expect(hasType("import")).toBe(true);
    } finally {
      rmSync(tmpDirSync, { recursive: true, force: true });
    }
  });

  it("does not re-emit for unchanged file (hash cache)", async () => {
    const tmpDirSync = mkdtempSync(join(tmpdir(), "qunoqu-cache-"));
    try {
      const w = new FileWatcher(tmpDirSync, { projectId: "test" });
      const captured: unknown[] = [];
      w.on(CONTEXT_CAPTURED_EVENT, (items: unknown) => captured.push(items));
      w.on("error", () => {});

      w.watch();

      const srcFile = join(tmpDirSync, "same.ts");
      writeFileSync(srcFile, "class Same {}");
      await new Promise((r) => setTimeout(r, 500));
      writeFileSync(srcFile, "class Same {}");
      await new Promise((r) => setTimeout(r, 500));

      await w.close();

      const count = (captured as unknown[][]).reduce(
        (n, batch) => n + (Array.isArray(batch) ? batch.length : 0),
        0
      );
      expect(count).toBeGreaterThan(0);
      const classItems = (captured as { type?: string }[][]).flat().filter((i) => i?.type === "class");
      expect(classItems.length).toBe(1);
    } finally {
      rmSync(tmpDirSync, { recursive: true, force: true });
    }
  });
});
