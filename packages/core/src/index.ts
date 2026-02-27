/**
 * @qunoqu/core – capture + storage engine
 */

export function hello(): string {
  return "qunoqu core";
}

export { FileWatcher, CONTEXT_CAPTURED_EVENT } from "./FileWatcher.js";
export type { FileWatcherOptions, FileWatcherEvents } from "./FileWatcher.js";
export { extractContext } from "./extractContext.js";
export type { ContextItem, ContextItemType, TerminalEvent } from "./types.js";
export { DEFAULT_IGNORE_PATTERNS } from "./types.js";
export { TerminalCapture, TERMINAL_EVENT } from "./TerminalCapture.js";
export type { TerminalCaptureOptions } from "./TerminalCapture.js";
export { SHELL_INTEGRATION_SCRIPT } from "./shellIntegrationScript.js";
export { MetadataStore } from "./MetadataStore.js";
export type { MetadataStoreOptions } from "./MetadataStore.js";
export type {
  ProjectRow,
  ContextItemRow,
  DecisionRow,
  ContextItemTypeEnum,
  InsertProjectInput,
  InsertContextItemInput,
  InsertDecisionInput,
} from "./metadataTypes.js";
export { VectorStore } from "./VectorStore.js";
export type { VectorStoreOptions, SemanticSearchResult } from "./VectorStore.js";
export { OllamaEmbeddingFunction } from "./OllamaEmbeddingFunction.js";
export type { OllamaEmbeddingFunctionOptions } from "./OllamaEmbeddingFunction.js";
export { KnowledgeGraph } from "./KnowledgeGraph.js";
export type {
  KnowledgeGraphOptions,
  GraphNode,
  GraphEdge,
  GraphData,
  NodeType,
  RelationType,
} from "./KnowledgeGraph.js";
export { QunoqMCPServer, CLAUDE_DESKTOP_MCP_CONFIG } from "./QunoqMCPServer.js";
export type { QunoqMCPServerOptions } from "./QunoqMCPServer.js";
export { detectProjectId } from "./ProjectDetector.js";
export {
  createApp,
  startServer,
  ensureApiToken,
  getApiTokenPath,
  DEFAULT_API_PID_PATH,
} from "./server.js";
export type { ServerOptions, CreateAppOptions, ContextItemApi } from "./server.js";
