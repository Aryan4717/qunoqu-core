import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { FileWatcher, CONTEXT_CAPTURED_EVENT } from "./FileWatcher.js";

describe("FileWatcher", () => {
  let tmpDir: string;
  let watcher: FileWatcher | null = null;

  afterEach(async () => {
    if (watcher) {
      await watcher.close();
      watcher = null;
    }
    if (tmpDir) {
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("instantiates with default options", () => {
    watcher = new FileWatcher();
    expect(watcher).toBeDefined();
  });

  it("accepts projectId and ignore options", () => {
    watcher = new FileWatcher({
      projectId: "my-project",
      ignore: ["**/skip/**"],
    });
    expect(watcher).toBeDefined();
  });

  // Skipped: uses real chokidar watch; can hit EMFILE in environments with low file descriptor limits
  it.skip("emits context-captured when watching a directory and file is added", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "qunoqu-watch-"));
    watcher = new FileWatcher({ projectId: "test" });
    const captured: unknown[] = [];
    watcher.on(CONTEXT_CAPTURED_EVENT, (items: unknown) => captured.push(items));
    watcher.on("error", () => {});

    watcher.watch(tmpDir);

    const srcFile = join(tmpDir, "src.ts");
    await writeFile(
      srcFile,
      "class Foo {} function bar() {} // TODO: x\nimport { x } from 'y';"
    );

    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 1200);
      watcher!.on(CONTEXT_CAPTURED_EVENT, () => {
        clearTimeout(t);
        resolve();
      });
    });

    await watcher!.close();
    watcher = null;

    expect(captured.length).toBeGreaterThan(0);
    const allItems = (captured as unknown[][])?.flat?.() ?? captured;
    const items = Array.isArray(allItems) ? allItems : [];
    expect(items.some((i: { type?: string }) => i?.type === "class")).toBe(true);
    expect(items.some((i: { type?: string }) => i?.type === "function")).toBe(true);
    expect(items.some((i: { type?: string }) => i?.type === "todo")).toBe(true);
    expect(items.some((i: { type?: string }) => i?.type === "import")).toBe(true);
  });

  it.skip("does not re-emit for unchanged file (hash cache)", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "qunoqu-cache-"));
    watcher = new FileWatcher({ projectId: "test" });
    const captured: unknown[] = [];
    watcher.on(CONTEXT_CAPTURED_EVENT, (items: unknown) => captured.push(items));
    watcher.on("error", () => {});

    watcher.watch(tmpDir);

    const srcFile = join(tmpDir, "same.ts");
    await writeFile(srcFile, "class Same {}");
    await new Promise((r) => setTimeout(r, 500));
    await writeFile(srcFile, "class Same {}");
    await new Promise((r) => setTimeout(r, 500));

    await watcher!.close();
    watcher = null;

    const count = (captured as unknown[][]).reduce(
      (n, batch) => n + (Array.isArray(batch) ? batch.length : 0),
      0
    );
    expect(count).toBeGreaterThan(0);
    const classItems = (captured as { type?: string }[][]).flat().filter((i) => i?.type === "class");
    expect(classItems.length).toBe(1);
  });
});
