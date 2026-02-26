/**
 * Types for SQLite metadata store (projects, context_items, decisions).
 */

export type ContextItemTypeEnum =
  | "file_change"
  | "terminal_cmd"
  | "decision"
  | "comment";

export interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  created_at: number;
  last_active: number;
}

export interface ContextItemRow {
  id: string;
  project_id: string;
  type: ContextItemTypeEnum;
  content: string;
  file_path: string | null;
  embedding_id: string | null;
  tags: string[];
  created_at: number;
  is_stale: boolean;
}

export interface DecisionRow {
  id: string;
  project_id: string;
  title: string;
  rationale: string;
  decided_at: number;
  source_file: string | null;
}

export interface InsertProjectInput {
  name: string;
  root_path: string;
}

export interface InsertContextItemInput {
  project_id: string;
  type: ContextItemTypeEnum;
  content: string;
  file_path?: string | null;
  embedding_id?: string | null;
  tags?: string[];
}

export interface InsertDecisionInput {
  project_id: string;
  title: string;
  rationale: string;
  source_file?: string | null;
}
