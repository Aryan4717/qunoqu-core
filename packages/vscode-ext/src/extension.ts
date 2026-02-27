/**
 * @qunoqu/vscode-ext – VS Code extension: activation, status bar, recall, save decision.
 */

import * as vscode from "vscode";
import { basename } from "path";

// Core is ESM; use dynamic import so extension (CommonJS) can load it
type Core = typeof import("@qunoqu/core");

let core: Core | null = null;
let metadataStore: InstanceType<Core["MetadataStore"]> | null = null;
let knowledgeGraph: InstanceType<Core["KnowledgeGraph"]> | null = null;
let fileWatcher: InstanceType<Core["FileWatcher"]> | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;
let statusBarUpdateInterval: ReturnType<typeof setInterval> | null = null;
let workspaceRoot: string | null = null;
let projectId: string | null = null;

const CONTEXT_CAPTURED_EVENT = "context-captured" as const;
const STATUS_BAR_REFRESH_MS = 30_000;

async function loadCore(): Promise<Core> {
  if (core) return core;
  core = await import("@qunoqu/core");
  return core;
}

function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const uri = folders[0].uri;
  if (uri.scheme !== "file") return null;
  return uri.fsPath;
}

/** Get or create project id for current workspace. Uses root_path to find existing. */
function getOrCreateProjectId(store: InstanceType<Core["MetadataStore"]>, root: string, name: string): string {
  const projects = store.listProjects();
  const existing = projects.find((p) => p.root_path === root);
  if (existing) return existing.id;
  return store.insertProject({ name, root_path: root });
}

function getMemoryCount(): number {
  if (!metadataStore || !projectId) return 0;
  try {
    return metadataStore.getByProject(projectId).length;
  } catch {
    return 0;
  }
}

function updateStatusBar(): void {
  if (!statusBarItem) return;
  const n = getMemoryCount();
  statusBarItem.text = `$(book) Qunoqu: ${n} memories`;
  statusBarItem.tooltip = "Click to search memories (recall)";
  statusBarItem.show();
}

/** Map FileWatcher ContextItem type to metadata store type; store file-derived context as file_change. */
function toStoreType(): "file_change" {
  return "file_change";
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    return;
  }

  const c = await loadCore();
  // Use default ~/.qunoqu paths so extension shares memory with CLI/MCP
  metadataStore = new c.MetadataStore();
  knowledgeGraph = new c.KnowledgeGraph();

  projectId = getOrCreateProjectId(metadataStore, root, basename(root) || "workspace");
  workspaceRoot = root;

  // File watcher: on context-captured, persist to MetadataStore
  fileWatcher = new c.FileWatcher(root, { projectId });
  fileWatcher.on("error", (err: unknown) => {
    console.error("[qunoqu] FileWatcher error:", err);
  });
  fileWatcher.on(CONTEXT_CAPTURED_EVENT, (items: Array<{ content: string; filePath: string; type: string; projectId: string; timestamp?: number }>) => {
    if (!metadataStore || !projectId) return;
    for (const item of items) {
      const contextItem = {
        type: item.type as "function" | "class" | "todo" | "import" | "architecture-decision",
        content: item.content,
        filePath: item.filePath,
        timestamp: item.timestamp ?? Date.now(),
        projectId: item.projectId,
      };
      const filtered = c.filterContextItem(contextItem, root);
      if (!filtered) continue;
      try {
        metadataStore.insertContextItem({
          project_id: projectId,
          type: toStoreType(),
          content: filtered.content,
          file_path: filtered.filePath || null,
          tags: [filtered.type],
        });
      } catch (e) {
        console.error("[qunoqu] insertContextItem error:", e);
      }
    }
    updateStatusBar();
  });
  fileWatcher.watch();

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);
  statusBarItem.command = "qunoqu.recall";
  updateStatusBar();
  statusBarUpdateInterval = setInterval(updateStatusBar, STATUS_BAR_REFRESH_MS);
  context.subscriptions.push({
    dispose: () => {
      if (statusBarUpdateInterval) {
        clearInterval(statusBarUpdateInterval);
        statusBarUpdateInterval = null;
      }
    },
  });

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("qunoqu.recall", () => runRecall()),
    vscode.commands.registerCommand("qunoqu.saveDecision", () => runSaveDecision())
  );
}

export async function deactivate(): Promise<void> {
  if (statusBarUpdateInterval) {
    clearInterval(statusBarUpdateInterval);
    statusBarUpdateInterval = null;
  }
  if (fileWatcher) {
    await fileWatcher.close();
    fileWatcher = null;
  }
  if (metadataStore && "close" in metadataStore) {
    (metadataStore as { close(): void }).close();
    metadataStore = null;
  }
  statusBarItem = null;
  projectId = null;
  workspaceRoot = null;
}

async function runRecall(): Promise<void> {
  const store = metadataStore;
  const pid = projectId;
  if (!store || !pid) {
    vscode.window.showWarningMessage("Qunoqu: No workspace or project. Open a folder first.");
    return;
  }

  const query = await new Promise<string | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { content?: string }>();
    qp.placeholder = "Type to search memories…";
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;

    let debounce: ReturnType<typeof setTimeout> | null = null;
    qp.onDidChangeValue((value) => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        const trimmed = value.trim();
        qp.busy = true;
        try {
          const results = trimmed
            ? store.keywordSearch(trimmed, { projectId: pid, limit: 15 })
            : store.getByProject(pid).slice(0, 15);
          qp.items = results.map((r) => ({
            label: r.content.slice(0, 60) + (r.content.length > 60 ? "…" : ""),
            description: r.file_path ?? undefined,
            detail: `[${r.type}]`,
            content: r.content,
          }));
        } catch {
          qp.items = [];
        }
        qp.busy = false;
        if (debounce) clearTimeout(debounce);
        debounce = null;
      }, 200);
    });
    // Initial load: recent items when quick pick opens
    try {
      const initial = store.getByProject(pid).slice(0, 15);
      qp.items = initial.map((r) => ({
        label: r.content.slice(0, 60) + (r.content.length > 60 ? "…" : ""),
        description: r.file_path ?? undefined,
        detail: `[${r.type}]`,
        content: r.content,
      }));
    } catch {
      qp.items = [];
    }

    qp.onDidAccept(() => {
      const sel = qp.selectedItems[0] as (vscode.QuickPickItem & { content?: string }) | undefined;
      if (sel?.content) {
        vscode.env.clipboard.writeText(sel.content);
        vscode.window.showInformationMessage("Copied to clipboard.");
      }
      qp.hide();
      resolve(sel?.content);
    });
    qp.onDidHide(() => {
      if (debounce) clearTimeout(debounce);
      resolve(undefined);
    });
    qp.show();
  });
}

async function runSaveDecision(): Promise<void> {
  if (!metadataStore || !knowledgeGraph || !projectId) {
    vscode.window.showWarningMessage("Qunoqu: No workspace or project. Open a folder first.");
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "Decision title",
    placeHolder: "e.g. Use TypeScript strict mode",
    validateInput: (v) => (v.trim() ? null : "Title is required"),
  });
  if (title === undefined || !title.trim()) return;

  const rationale = await vscode.window.showInputBox({
    prompt: "Rationale",
    placeHolder: "Why this decision?",
    validateInput: (v) => (v.trim() ? null : "Rationale is required"),
  });
  if (rationale === undefined || !rationale.trim()) return;

  try {
    const id = metadataStore.insertDecision({
      project_id: projectId,
      title: title.trim(),
      rationale: rationale.trim(),
    });
    const nodeId = `decision:${projectId}:${id}`;
    knowledgeGraph.addNode({
      id: nodeId,
      type: "decision",
      label: title.trim().slice(0, 80),
      projectId,
      metadata: { rationale: rationale.trim().slice(0, 200) },
    });
    knowledgeGraph.save();
    updateStatusBar();
    vscode.window.showInformationMessage(`Saved decision: "${title.trim()}"`);
  } catch (e) {
    vscode.window.showErrorMessage("Qunoqu: Failed to save decision. " + (e instanceof Error ? e.message : String(e)));
  }
}
