/**
 * Typed context item emitted when file context is captured.
 */
export interface ContextItem {
  type: ContextItemType;
  content: string;
  filePath: string;
  timestamp: number;
  projectId: string;
}

export type ContextItemType =
  | "function"
  | "class"
  | "todo"
  | "import"
  | "architecture-decision";

export const DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
] as const;

/**
 * Terminal event sent from shell integration and emitted by TerminalCapture.
 */
export interface TerminalEvent {
  command: string;
  exitCode: number;
  cwd: string;
  output: string;
  timestamp: number;
  projectId: string;
}
