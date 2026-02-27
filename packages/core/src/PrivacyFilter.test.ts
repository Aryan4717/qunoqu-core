import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { PrivacyFilter, filterContextItem } from "./PrivacyFilter.js";
import type { ContextItem } from "./types.js";

describe("PrivacyFilter", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "qunoqu-privacy-"));
    logPath = join(tmpDir, "privacy.log");
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function item(overrides: Partial<ContextItem> = {}): ContextItem {
    return {
      type: "function",
      content: "foo",
      filePath: join(tmpDir, "src/bar.ts"),
      timestamp: Date.now(),
      projectId: "p1",
      ...overrides,
    };
  }

  it("filterContextItem returns item when nothing to filter", () => {
    const result = filterContextItem(item({ content: "hello" }), { projectRoot: tmpDir, logPath });
    expect(result).not.toBeNull();
    expect(result!.content).toBe("hello");
  });

  it("drops item when path matches .qunoqu-ignore", () => {
    writeFileSync(join(tmpDir, ".qunoqu-ignore"), "secret.txt\n", "utf-8");
    const filter = new PrivacyFilter({ projectRoot: tmpDir, logPath });
    const result = filter.filter(item({ filePath: join(tmpDir, "secret.txt"), content: "x" }));
    expect(result).toBeNull();
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, "utf-8")).toContain("path_ignored");
  });

  it("drops item when path matches default ignore (.env)", () => {
    const filter = new PrivacyFilter({ projectRoot: tmpDir, logPath });
    const result = filter.filter(item({ filePath: join(tmpDir, ".env"), content: "KEY=val" }));
    expect(result).toBeNull();
    expect(readFileSync(logPath, "utf-8")).toContain("path_ignored");
  });

  it("redacts password = value in content", () => {
    const filter = new PrivacyFilter({ projectRoot: tmpDir, logPath });
    const result = filter.filter(item({ content: 'const password = "super-secret-123";' }));
    expect(result).not.toBeNull();
    expect(result!.content).toBe('const password = "[REDACTED]";');
    expect(readFileSync(logPath, "utf-8")).toContain("password_in_content_detected");
  });

  it("truncates content over max length", () => {
    const filter = new PrivacyFilter({ projectRoot: tmpDir, maxContentLength: 10, logPath });
    const result = filter.filter(item({ content: "12345678901234567890" }));
    expect(result).not.toBeNull();
    expect(result!.content.length).toBe(10);
    expect(result!.content).toBe("1234567890");
    expect(readFileSync(logPath, "utf-8")).toContain("content_truncated");
  });

  it("redacts private key block", () => {
    const filter = new PrivacyFilter({ projectRoot: tmpDir, logPath });
    const content = "key:\n-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg\n-----END PRIVATE KEY-----";
    const result = filter.filter(item({ content }));
    expect(result).not.toBeNull();
    expect(result!.content).toContain("[REDACTED]");
    expect(result!.content).not.toContain("MIIEvgIBADANBg");
    expect(readFileSync(logPath, "utf-8")).toContain("private_key_detected");
  });

  it("returns null for path ignored, does not log secret content", () => {
    writeFileSync(join(tmpDir, ".qunoqu-ignore"), "*.key\n", "utf-8");
    const filter = new PrivacyFilter({ projectRoot: tmpDir, logPath });
    const result = filter.filter(item({ filePath: join(tmpDir, "my.key"), content: "secret-key-12345" }));
    expect(result).toBeNull();
    const log = readFileSync(logPath, "utf-8");
    expect(log).not.toContain("secret-key-12345");
    expect(log).toContain("path_ignored");
  });
});
