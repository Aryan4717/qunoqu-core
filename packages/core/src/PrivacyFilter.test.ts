import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { PrivacyFilter, filterContextItem, getPrivacyLogPath } from "./PrivacyFilter.js";
import type { ContextItem } from "./types.js";

describe("PrivacyFilter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "qunoqu-privacy-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("getPrivacyLogPath returns path under .qunoqu", () => {
    const path = getPrivacyLogPath();
    expect(path).toContain(".qunoqu");
    expect(path).toContain("privacy.log");
  });

  it("filterContextItem returns null when path matches default ignore", () => {
    const item: ContextItem = {
      type: "function",
      content: "function foo() {}",
      filePath: join(tmpDir, ".env"),
      timestamp: Date.now(),
      projectId: "p1",
    };
    const result = filterContextItem(item, tmpDir);
    expect(result).toBeNull();
  });

  it("filterContextItem drops path matching .qunoqu-ignore", () => {
    writeFileSync(join(tmpDir, ".qunoqu-ignore"), "*.local\n", "utf-8");
    const item: ContextItem = {
      type: "function",
      content: "x",
      filePath: join(tmpDir, "config.local"),
      timestamp: Date.now(),
      projectId: "p1",
    };
    const result = filterContextItem(item, tmpDir);
    expect(result).toBeNull();
  });

  it("filterContextItem returns item when path does not match ignore", () => {
    const item: ContextItem = {
      type: "function",
      content: "function bar() {}",
      filePath: join(tmpDir, "src", "index.ts"),
      timestamp: Date.now(),
      projectId: "p1",
    };
    const result = filterContextItem(item, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("function bar() {}");
  });

  it("scrubs JWT from content", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const item: ContextItem = {
      type: "comment",
      content: `token is ${jwt} end`,
      filePath: join(tmpDir, "src", "auth.ts"),
      timestamp: Date.now(),
      projectId: "p1",
    };
    const result = filterContextItem(item, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.content).not.toContain(jwt);
    expect(result!.content).toContain("[REDACTED]");
  });

  it("scrubs password= from content", () => {
    const item: ContextItem = {
      type: "comment",
      content: 'const password="super-secret-123";',
      filePath: join(tmpDir, "src", "config.ts"),
      timestamp: Date.now(),
      projectId: "p1",
    };
    const result = filterContextItem(item, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.content).not.toContain("super-secret-123");
    expect(result!.content).toContain("[REDACTED]");
  });

  it("truncates content to max length", () => {
    const filter = new PrivacyFilter({ projectRoot: tmpDir, maxContentChars: 50 });
    const longContent = "short words " + "word ".repeat(30);
    const item: ContextItem = {
      type: "comment",
      content: longContent,
      filePath: join(tmpDir, "src", "x.ts"),
      timestamp: Date.now(),
      projectId: "p1",
    };
    const result = filter.filter(item);
    expect(result).not.toBeNull();
    expect(result!.content.length).toBeLessThanOrEqual(50);
    expect(result!.content.length).toBe(50);
  });

  it("PrivacyFilter with .qunoqu-ignore respects custom patterns", () => {
    writeFileSync(join(tmpDir, ".qunoqu-ignore"), "skip/", "utf-8");
    const filter = new PrivacyFilter({ projectRoot: tmpDir });
    const item: ContextItem = {
      type: "function",
      content: "x",
      filePath: join(tmpDir, "skip", "file.ts"),
      timestamp: Date.now(),
      projectId: "p1",
    };
    const result = filter.filter(item);
    expect(result).toBeNull();
  });

  it("item with empty filePath is not dropped by path ignore", () => {
    const item: ContextItem = {
      type: "function",
      content: "terminal output",
      filePath: "",
      timestamp: Date.now(),
      projectId: "p1",
    };
    const result = filterContextItem(item, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("terminal output");
  });
});
