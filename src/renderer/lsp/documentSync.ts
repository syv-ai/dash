import type { editor as monacoEditor, IDisposable } from 'monaco-editor';
import { onWorkingModel } from '../components/diffEditor/models';
import { useProjects } from '../stores/projectsStore';
import { worktreeFor } from './protocol';

/*
 * Keeps the language servers' view of the working files in step with their
 * Monaco models: open on `onWorkingModel`, full-text change (debounced, and
 * flushed before any request), close when the model goes. Only working
 * (`file://`) models of a live task's worktree take part; the `git:` snapshot
 * side of a diff never does.
 */

type Model = monacoEditor.ITextModel;

const CHANGE_DEBOUNCE_MS = 75;

export interface SyncedDocument {
  model: Model;
  uri: string;
  worktree: string;
  serverId: string;
}

interface Doc {
  model: Model;
  uri: string;
  worktree: string;
  /** Settles with the serving server's id, or null when no server handles the file. */
  ready: Promise<string | null>;
  serverId: string | null;
  sentVersion: number;
  timer: ReturnType<typeof setTimeout> | null;
  sub: IDisposable;
}

const docs = new Map<string, Doc>();
const closeListeners = new Set<(model: Model) => void>();

function liveWorktrees(): string[] {
  const paths: string[] = [];
  for (const tasks of Object.values(useProjects.getState().tasksByProject))
    for (const t of tasks) if (!t.archivedAt && t.path) paths.push(t.path);
  return paths;
}

function flush(doc: Doc): void {
  if (doc.timer) clearTimeout(doc.timer);
  doc.timer = null;
  if (!doc.serverId || doc.model.isDisposed()) return;
  const version = doc.model.getVersionId();
  if (version <= doc.sentVersion) return;
  doc.sentVersion = version;
  window.electronAPI.lspChange({ uri: doc.uri, version, text: doc.model.getValue() });
}

function opened(model: Model): void {
  const uri = model.uri.toString();
  const worktree = worktreeFor(model.uri.fsPath, liveWorktrees());
  if (!worktree || docs.has(uri)) return;
  const version = model.getVersionId();
  const doc: Doc = {
    model,
    uri,
    worktree,
    serverId: null,
    sentVersion: version,
    timer: null,
    ready: Promise.resolve(null),
    // Edits while the open is in flight wait for it: the server may be none.
    sub: model.onDidChangeContent(() => {
      if (!doc.serverId) return;
      if (doc.timer) clearTimeout(doc.timer);
      doc.timer = setTimeout(() => flush(doc), CHANGE_DEBOUNCE_MS);
    }),
  };
  doc.ready = window.electronAPI
    .lspOpen({ worktree, uri, version, text: model.getValue() })
    .then((resp) => {
      if (docs.get(uri) !== doc) return null;
      const serverId = (resp.success && resp.data?.serverId) || null;
      if (!serverId) {
        if (!resp.success) console.warn('[lsp] open failed:', resp.error);
        doc.sub.dispose();
        return null;
      }
      doc.serverId = serverId;
      flush(doc);
      return serverId;
    });
  docs.set(uri, doc);
}

function closed(model: Model): void {
  const uri = model.uri.toString();
  const doc = docs.get(uri);
  if (!doc) return;
  docs.delete(uri);
  if (doc.timer) clearTimeout(doc.timer);
  doc.sub.dispose();
  // Ordered after the open on the same IPC pipe; a no-op for an unserved file.
  window.electronAPI.lspClose({ uri });
  for (const l of closeListeners) l(model);
}

/** Start syncing working models (those open now included). */
export function startDocumentSync(): () => void {
  return onWorkingModel({ opened, closed });
}

/** The model's served document, with every edit sent: what a request goes
 *  out against. Null when the model isn't synced or no server handles it. */
export async function syncedDocument(model: Model): Promise<SyncedDocument | null> {
  const doc = docs.get(model.uri.toString());
  if (!doc || doc.model !== model) return null;
  const serverId = await doc.ready;
  if (!serverId || docs.get(doc.uri) !== doc) return null;
  flush(doc);
  return { model, uri: doc.uri, worktree: doc.worktree, serverId };
}

/** Whether `uri` is a served document right now (diagnostics routing). */
export function isServed(uri: string): boolean {
  return docs.get(uri)?.serverId != null;
}

/** Follow synced documents closing (to clear what was drawn for them). */
export function onDocumentClosed(listener: (model: Model) => void): () => void {
  closeListeners.add(listener);
  return () => closeListeners.delete(listener);
}
