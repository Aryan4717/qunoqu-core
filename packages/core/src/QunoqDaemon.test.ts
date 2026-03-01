import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { EventEmitter } from "events";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { QunoqDaemon } from "./QunoqDaemon.js";
import { MetadataStore } from "./MetadataStore.js";
import type { ContextItem } from "./types.js";

const { mockServer, vectorStoreMocks } = vi.hoisted(() => {
  return {
    mockServer: { close: (cb?: () => void) => { if (cb) cb(); } },
    vectorStoreMocks: {
      hasAnyForProject: vi.fn().mockResolvedValue(false),
      addContext: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("./FileWatcher.js", () => {
  const { EventEmitter } = require("events");
  return {
    FileWatcher: class MockFileWatcher extends EventEmitter {
      watch() {
        return this;
      }
      async close() {}
    },
    CONTEXT_CAPTURED_EVENT: "context-captured",
  };
});

vi.mock("./TerminalCapture.js", () => {
  const { EventEmitter } = require("events");
  return {
    TerminalCapture: class MockTerminalCapture extends EventEmitter {
      start() {
        return Promise.resolve();
      }
      async stop() {
        return Promise.resolve();
      }
    },
    TERMINAL_EVENT: "terminal-event",
  };
});

vi.mock("./VectorStore.js", () => ({
  VectorStore: class MockVectorStore {
    async hasAnyForProject(projectId: string) {
      return vectorStoreMocks.hasAnyForProject(projectId);
    }
    async addContext(...args: unknown[]) {
      return vectorStoreMocks.addContext(...args);
    }
  },
}));

vi.mock("./server.js", () => ({
  startServer: vi.fn().mockResolvedValue({ server: mockServer, port: 7384 }),
}));

describe("QunoqDaemon", () => {
  let tmpDir: string;
  let daemon: QunoqDaemon;
  const projectId = "test-project-id";

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "qunoqu-daemon-"));
    vectorStoreMocks.hasAnyForProject.mockResolvedValue(false);
    vectorStoreMocks.addContext.mockResolvedValue(undefined);
    daemon = new QunoqDaemon({
      projectRoot: tmpDir,
      projectId,
      dbPath: join(tmpDir, "memory.db"),
      logPath: join(tmpDir, "daemon.log"),
      pidPath: join(tmpDir, "daemon.pid"),
    });
  });

  afterEach(async () => {
    if (daemon?.isRunning?.()) {
      await daemon.stop();
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.clearAllMocks();
  });

  it("daemon starts without crashing", async () => {
    await daemon.start();
    expect(daemon.isRunning()).toBe(true);
    const status = daemon.getStatus();
    expect(status.running).toBe(true);
    expect(status.projectId).toBe(projectId);
    expect(status.projectRoot).toBe(tmpDir);
  });

  it("daemon stores file change item to SQLite via storeItem()", async () => {
    await daemon.start();
    const item: ContextItem = {
      type: "function",
      content: "function foo() {}",
      filePath: join(tmpDir, "src", "index.ts"),
      timestamp: Date.now(),
      projectId,
    };
    await daemon.storeItem(item, "file_change");
    const store = new MetadataStore({ dbPath: join(tmpDir, "memory.db") });
    const rows = store.getByProject(projectId);
    store.close();
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe("file_change");
    expect(rows[0].content).toBe("function foo() {}");
  });

  it("daemon drops .env file via PrivacyFilter", async () => {
    await daemon.start();
    const item: ContextItem = {
      type: "function",
      content: "secret=xyz",
      filePath: join(tmpDir, ".env"),
      timestamp: Date.now(),
      projectId,
    };
    await daemon.storeItem(item, "file_change");
    const store = new MetadataStore({ dbPath: join(tmpDir, "memory.db") });
    const rows = store.getByProject(projectId);
    store.close();
    expect(rows.length).toBe(0);
  });

  it("daemon redacts API key in content", async () => {
    await daemon.start();
    const item: ContextItem = {
      type: "comment",
      content: "api_key=abcdefghij12345678901234567890",
      filePath: join(tmpDir, "src", "config.ts"),
      timestamp: Date.now(),
      projectId,
    };
    await daemon.storeItem(item, "file_change");
    const store = new MetadataStore({ dbPath: join(tmpDir, "memory.db") });
    const rows = store.getByProject(projectId);
    store.close();
    expect(rows.length).toBe(1);
    expect(rows[0].content).toContain("[REDACTED]");
    expect(rows[0].content).not.toContain("abcdefghij12345678901234567890");
  });

  it("daemon stores terminal command to SQLite", async () => {
    await daemon.start();
    const item: ContextItem = {
      type: "todo",
      content: "npm install",
      filePath: "",
      timestamp: Date.now(),
      projectId,
    };
    await daemon.storeItem(item, "terminal_cmd");
    const store = new MetadataStore({ dbPath: join(tmpDir, "memory.db") });
    const rows = store.getByProject(projectId);
    store.close();
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe("terminal_cmd");
    expect(rows[0].content).toBe("npm install");
  });

  it("daemon stop() cleans up all resources", async () => {
    await daemon.start();
    expect(daemon.isRunning()).toBe(true);
    await daemon.stop();
    expect(daemon.isRunning()).toBe(false);
    expect(existsSync(join(tmpDir, "daemon.pid"))).toBe(false);
  });

  it("getStatus() returns correct running state", async () => {
    let status = daemon.getStatus();
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
    await daemon.start();
    status = daemon.getStatus();
    expect(status.running).toBe(true);
    expect(status.totalCaptured).toBe(0);
    expect(status.capturedToday).toBe(0);
  });

  it("syncChromaFromSQLite() called on start", async () => {
    await daemon.start();
    expect(vectorStoreMocks.hasAnyForProject).toHaveBeenCalledWith(projectId);
  });

  it("storeItem() skips ChromaDB gracefully when VectorStore fails", async () => {
    vectorStoreMocks.addContext.mockRejectedValueOnce(new Error("Chroma down"));
    await daemon.start();
    const item: ContextItem = {
      type: "function",
      content: "function bar() {}",
      filePath: join(tmpDir, "src", "bar.ts"),
      timestamp: Date.now(),
      projectId,
    };
    await daemon.storeItem(item, "file_change");
    const store = new MetadataStore({ dbPath: join(tmpDir, "memory.db") });
    const rows = store.getByProject(projectId);
    store.close();
    expect(rows.length).toBe(1);
    expect(rows[0].content).toBe("function bar() {}");
  });

  it("daemon handles SIGTERM cleanly", async () => {
    await daemon.start();
    await daemon.stop();
    expect(daemon.isRunning()).toBe(false);
  });
});
