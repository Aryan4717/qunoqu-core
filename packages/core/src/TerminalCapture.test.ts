import { describe, it, expect, afterEach } from "vitest";
import { connect } from "net";
import { join } from "path";
import { tmpdir } from "os";
import { TerminalCapture, TERMINAL_EVENT } from "./TerminalCapture.js";

describe("TerminalCapture", () => {
  let capture: TerminalCapture | null = null;

  function testSocketPath(): string {
    return join(tmpdir(), "qunoqu-test-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".sock");
  }

  afterEach(async () => {
    if (capture) {
      await capture.stop();
      capture = null;
    }
  });

  it.skipIf(process.env.CI === "true" || process.env.SANDBOX === "1")(
    "starts and accepts JSON payloads",
    async () => {
    capture = new TerminalCapture({ socketPath: testSocketPath(), projectId: "test" });
    const events: unknown[] = [];
    capture.on(TERMINAL_EVENT, (e: unknown) => events.push(e));

    await capture.start();

    const payload = JSON.stringify({
      command: "npm install",
      exitCode: 0,
      cwd: "/home/proj",
      output: "added 42 packages",
      timestamp: Date.now(),
      projectId: "test",
    }) + "\n";

    await new Promise<void>((resolve, reject) => {
      const client = connect(capture!.getSocketPath(), () => {
        client.write(payload, (err) => {
          if (err) reject(err);
          else {
            client.end();
            setTimeout(resolve, 50);
          }
        });
      });
      client.on("error", reject);
    });

    expect(events.length).toBe(1);
    expect((events[0] as { command: string }).command).toBe("npm install");
    expect((events[0] as { exitCode: number }).exitCode).toBe(0);
    expect((events[0] as { cwd: string }).cwd).toBe("/home/proj");
  }
  );

  it.skipIf(process.env.CI === "true" || process.env.SANDBOX === "1")(
    "filters out empty and noise commands",
    async () => {
    capture = new TerminalCapture({ socketPath: testSocketPath(), projectId: "test" });
    const events: unknown[] = [];
    capture.on(TERMINAL_EVENT, (e: unknown) => events.push(e));

    await capture.start();

    const send = (cmd: string) =>
      new Promise<void>((resolve, reject) => {
        const client = connect(capture!.getSocketPath(), () => {
          client.write(
            JSON.stringify({
              command: cmd,
              exitCode: 0,
              cwd: "/tmp",
              output: "",
              timestamp: Date.now(),
              projectId: "test",
            }) + "\n",
            () => {
              client.end();
              setTimeout(resolve, 30);
            }
          );
        });
        client.on("error", reject);
      });

    await send("");
    await send("cd /tmp");
    await send("ls");
    await send("pwd");
    await send("echo hi");
    await send("npm run build");

    expect(events.length).toBe(1);
    expect((events[0] as { command: string }).command).toBe("npm run build");
  }
  );

  it.skipIf(process.env.CI === "true" || process.env.SANDBOX === "1")(
    "ignores invalid JSON",
    async () => {
    capture = new TerminalCapture({ socketPath: testSocketPath(), projectId: "test" });
    const events: unknown[] = [];
    capture.on(TERMINAL_EVENT, (e: unknown) => events.push(e));

    await capture.start();

    await new Promise<void>((resolve, reject) => {
      const client = connect(capture!.getSocketPath(), () => {
        client.write("not json\n", () => {
          client.end();
          setTimeout(resolve, 30);
        });
      });
      client.on("error", reject);
    });

    expect(events.length).toBe(0);
  }
  );
});
