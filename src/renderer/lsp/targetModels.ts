import type { editor as monacoEditor } from 'monaco-editor';
import { monaco } from '../monaco-workers';
import {
  acquireWorking,
  holdUntilRetained,
  isDirty,
  release,
} from '../components/diffEditor/models';
import { selectActiveTask, useProjects } from '../stores/projectsStore';
import { useEditorTabs } from '../stores/editorTabsStore';

/*
 * Models for files a language result points into. Monaco's peek views and
 * workspace edits only work on models that exist, so the files a result
 * names are loaded as the same shared working models tabs use.
 */

type Model = monacoEditor.ITextModel;

const PEEK_HOLDER = 'lsp:peek';
const EDIT_HOLDER = 'lsp:edit';
/** Files kept loaded for peek views beyond those open in tabs. */
const PEEK_CAP = 20;
const peeked: Model[] = [];

function existing(uri: string): Model | null {
  return monaco.editor.getModel(monaco.Uri.parse(uri));
}

/** `uri`'s path inside `worktree`, or null outside it. */
function relativePath(worktree: string, uri: string): string | null {
  const parsed = monaco.Uri.parse(uri);
  if (parsed.scheme !== 'file') return null;
  const root = worktree.replace(/\/+$/, '');
  return parsed.fsPath.startsWith(`${root}/`) ? parsed.fsPath.slice(root.length + 1) : null;
}

/** Read the working file at `uri` into its shared model, held by `holder`. */
async function load(worktree: string, uri: string, holder: string): Promise<Model | null> {
  const rel = relativePath(worktree, uri);
  if (!rel) return null;
  const resp = await window.electronAPI.editorReadWorking({
    cwd: worktree,
    filePath: rel,
    ref: 'HEAD',
  });
  const data = resp.success ? resp.data : undefined;
  if (!data || data.workingContent === null || data.isBinary || data.isLargeFile) return null;
  return acquireWorking(holder, monaco.Uri.parse(uri).fsPath, data.workingContent, data.language, {
    mtimeMs: data.mtimeMs,
    sizeBytes: data.sizeBytes,
  });
}

/** Make sure the files at `uris` have models (for a peek view); returns the
 *  uris that do. The least recently peeked are let go past a cap, unless
 *  they were edited there. */
export async function ensurePeekModels(worktree: string, uris: string[]): Promise<Set<string>> {
  const ready = new Set<string>();
  await Promise.all(
    [...new Set(uris)].map(async (uri) => {
      if (existing(uri)) {
        ready.add(uri);
        return;
      }
      const model = await load(worktree, uri, PEEK_HOLDER);
      if (!model) return;
      ready.add(uri);
      peeked.push(model);
    }),
  );
  while (peeked.length > PEEK_CAP) {
    const i = peeked.findIndex((m) => m.isDisposed() || !isDirty(m.uri.toString()));
    if (i < 0) break;
    const [old] = peeked.splice(i, 1);
    if (old && !old.isDisposed()) release(PEEK_HOLDER, old);
  }
  return ready;
}

/**
 * Make sure every file an edit touches has a model, so the edit can be
 * applied. A file not loaded yet is read and opened in a background tab of
 * the active task's editor: its edits are unsaved, and the tab is where the
 * user sees and saves them. Returns false when a file can't be loaded (or
 * isn't in the active task's worktree).
 */
export async function ensureEditModels(worktree: string, uris: string[]): Promise<boolean> {
  const task = selectActiveTask(useProjects.getState());
  const missing = uris.filter((uri) => !existing(uri));
  if (missing.length === 0) return true;
  if (!task || task.path.replace(/\/+$/, '') !== worktree) return false;
  const loaded = await Promise.all(missing.map((uri) => load(worktree, uri, EDIT_HOLDER)));
  if (loaded.some((m) => !m)) {
    for (const m of loaded) if (m) release(EDIT_HOLDER, m);
    return false;
  }
  const tabs = useEditorTabs.getState();
  for (const model of loaded as Model[]) {
    holdUntilRetained(model);
    release(EDIT_HOLDER, model);
    tabs.open(task.id, relativePath(worktree, model.uri.toString())!, { background: true });
  }
  return true;
}
