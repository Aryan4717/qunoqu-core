/**
 * TerminalCapture – listens on a Unix socket for shell integration payloads and emits terminal-event.
 */

import { createServer, type Socket } from "net";
import { EventEmitter } from "events";
import { unlink } from "fs/promises";
import type { TerminalEvent } from "./types.js";

export const TERMINAL_EVENT = "terminal-event";
const DEFAULT_SOCKET_PATH = "/tmp/qunoqu.sock";

const NOISE_COMMANDS = new Set(["cd", "ls", "pwd", "echo"]);

function isNoiseCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return true;
  const first = trimmed.split(/\s+/)[0];
  return NOISE_COMMANDS.has(first);
}

function parseAndValidate(payload: string): TerminalEvent | null {
  try {
    const data = JSON.parse(payload) as Record<string, unknown>;
    if (
      typeof data.command !== "string" ||
      typeof data.exitCode !== "number" ||
      typeof data.cwd !== "string" ||
      typeof data.output !== "string" ||
      typeof data.timestamp !== "number" ||
      typeof data.projectId !== "string"
    )
      return null;
    return {
      command: data.command,
      exitCode: data.exitCode,
      cwd: data.cwd,
      output: data.output,
      timestamp: data.timestamp,
      projectId: data.projectId,
    };
  } catch {
    return null;
  }
}

export interface TerminalCaptureOptions {
  socketPath?: string;
  projectId?: string;
}

export class TerminalCapture extends EventEmitter {
  private server: ReturnType<typeof createServer> | null = null;
  private socketPath: string;
  private projectId: string;

  constructor(options: TerminalCaptureOptions = {}) {
    super();
    this.socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH;
    this.projectId = options.projectId ?? "default";
  }

  /**
   * Start listening on the Unix socket for shell integration JSON payloads.
   */
  start(): Promise<void> {
    return unlink(this.socketPath)
      .catch(() => {})
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            this.server = createServer((socket: Socket) => {
              let buffer = "";
              socket.setEncoding("utf8");
              socket.on("data", (chunk: string) => {
                buffer += chunk;
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                  const event = parseAndValidate(line.trim());
                  if (event && !isNoiseCommand(event.command)) {
                    super.emit(TERMINAL_EVENT, event);
                  }
                }
              });
            });

            this.server.on("error", (err: Error) => {
              this.emit("error", err);
            });

            this.server.listen(this.socketPath, () => {
              resolve();
            });

            this.server.once("error", reject);
          })
      );
  }

  /**
   * Stop the server and remove the socket file.
   */
  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        unlink(this.socketPath).catch(() => {}).finally(resolve);
      });
    });
  }

  getSocketPath(): string {
    return this.socketPath;
  }
}
