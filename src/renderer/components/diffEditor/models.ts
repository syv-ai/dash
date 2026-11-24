import type { editor as monacoEditor, IDisposable } from 'monaco-editor';
import { monaco } from '../../monaco-workers';

/*
 * The editor's text models, in one place.
 *
 * A working-tree file is one model per absolute path, at `file://<abs>`,
 * shared by every tab and group that shows it: an edit in one group shows in
 * the other, and the file is dirty once, not per view. Language servers sync
 * exactly these documents (`onWorkingModel` is the hook).
 *
 * Everything else (HEAD, the index, a commit, a branch base: the frozen side
 * of a diff) is a snapshot at `git:<abs>?<rev>`, a scheme nothing syncs.
 *
 * A model lives while something holds it: a pane holds the pair it shows
 * (`acquire*`/`release`), and the tab layout retains the working files that
 * are open in a tab (`retain`), so a background tab keeps its unsaved edits.
 * Released models are disposed a macrotask later, after any diff widget that
 * showed them has been given its next models (the reverse order throws).
 */

type Model = monacoEditor.ITextModel;

/** When the file on disk was last read or written: the guard a save sends. */
export interface DiskStamp {
  mtimeMs: number;
  sizeBytes: number;
}

interface Entry {
  model: Model;
  /** Panes showing it. */
  holders: Set<string>;
  /** Working files only: the alternative version id at the last load or save
   *  (undoing back to it is clean again), and the disk stamp then. */
  saved?: { versionId: number; stamp: DiskStamp; dirty: boolean };
  sub?: IDisposable;
}

const entries = new Map<string, Entry>();
/** Per holder (a tab layout), the uris it keeps alive without showing them. */
const retained = new Map<string, Set<string>>();

/** The working-tree file's uri. */
export function workingUri(absPath: string): string {
  return monaco.Uri.file(absPath).toString();
}

/** A frozen revision of a file (`rev`: HEAD, index, a sha, a base ref). */
export function snapshotUri(absPath: string, rev: string): string {
  return monaco.Uri.from({ scheme: 'git', path: absPath, query: rev }).toString();
}

// ── Change feed (dirty flags) ────────────────────────────────

let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version++;
  for (const l of listeners) l();
}

/** For useSyncExternalStore: fires when any working file's dirty flag flips. */
export function subscribeDirty(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dirtyVersion(): number {
  return version;
}

export function isDirty(uri: string): boolean {
  return entries.get(uri)?.saved?.dirty ?? false;
}

/** Any unsaved working file under `dir`. */
export function anyDirtyUnder(dir: string): boolean {
  const prefix = workingUri(dir.replace(/\/+$/, '')) + '/';
  for (const [uri, e] of entries) if (e.saved?.dirty && uri.startsWith(prefix)) return true;
  return false;
}

function updateDirty(e: Entry): void {
  if (!e.saved) return;
  const dirty = e.model.getAlternativeVersionId() !== e.saved.versionId;
  if (dirty === e.saved.dirty) return;
  e.saved.dirty = dirty;
  notify();
}

// ── Working-model lifecycle hook (language servers, 5b) ──────

export interface WorkingModelListener {
  opened(model: Model): void;
  closed(model: Model): void;
}

const workingListeners = new Set<WorkingModelListener>();

/** Follow working-tree models as they open and close: document sync hooks in
 *  here (`didOpen`/`didClose`; `model.onDidChangeContent` for `didChange`).
 *  Models already open are reported at once. */
export function onWorkingModel(listener: WorkingModelListener): () => void {
  workingListeners.add(listener);
  for (const e of entries.values()) if (e.saved) listener.opened(e.model);
  return () => workingListeners.delete(listener);
}

// ── Acquire / release ────────────────────────────────────────

function setLanguage(model: Model, language: string): void {
  const lang = language || 'plaintext';
  if (model.getLanguageId() !== lang) monaco.editor.setModelLanguage(model, lang);
}

/**
 * The working file at `absPath`, held by `holder`. A model already open keeps
 * its buffer when it has unsaved edits (they win over the disk); otherwise it
 * takes the freshly read `text`. `force` takes the disk's text regardless
 * (reload from disk).
 */
export function acquireWorking(
  holder: string,
  absPath: string,
  text: string,
  language: string,
  stamp: DiskStamp,
  force = false,
): Model {
  const uri = workingUri(absPath);
  const existing = entries.get(uri);
  if (existing?.saved) {
    existing.holders.add(holder);
    setLanguage(existing.model, language);
    if (force || !existing.saved.dirty) {
      if (existing.model.getValue() !== text) existing.model.setValue(text);
      markSaved(existing.model, stamp);
    }
    return existing.model;
  }
  const model = monaco.editor.createModel(text, language || 'plaintext', monaco.Uri.parse(uri));
  const entry: Entry = {
    model,
    holders: new Set([holder]),
    saved: { versionId: model.getAlternativeVersionId(), stamp, dirty: false },
  };
  entry.sub = model.onDidChangeContent(() => updateDirty(entry));
  entries.set(uri, entry);
  for (const l of workingListeners) l.opened(model);
  return model;
}

/** A frozen revision of `absPath`, held by `holder`. */
export function acquireSnapshot(
  holder: string,
  absPath: string,
  rev: string,
  text: string,
  language: string,
): Model {
  const uri = snapshotUri(absPath, rev);
  const existing = entries.get(uri);
  if (existing) {
    existing.holders.add(holder);
    setLanguage(existing.model, language);
    // HEAD and the index move; a sha's text never changes.
    if (existing.model.getValue() !== text) existing.model.setValue(text);
    return existing.model;
  }
  const model = monaco.editor.createModel(text, language || 'plaintext', monaco.Uri.parse(uri));
  entries.set(uri, { model, holders: new Set([holder]) });
  return model;
}

/** `holder` no longer shows `model`. */
export function release(holder: string, model: Model): void {
  const uri = model.uri.toString();
  entries.get(uri)?.holders.delete(holder);
  scheduleDispose(uri);
}

/** Held until a tab layout retains it: see `holdUntilRetained`. */
const UNTIL_RETAINED = '\0until-retained';

/** Keep exactly these working files alive for `holder` (the open tabs). */
export function retain(holder: string, absPaths: readonly string[]): void {
  const next = new Set(absPaths.map(workingUri));
  for (const uri of next) entries.get(uri)?.holders.delete(UNTIL_RETAINED);
  const prev = retained.get(holder);
  if (next.size === 0) retained.delete(holder);
  else retained.set(holder, next);
  if (prev) for (const uri of prev) if (!next.has(uri)) scheduleDispose(uri);
}

/** Drop everything `holder` retains (its layout went away). */
export function releaseRetained(holder: string): void {
  retain(holder, []);
}

/** Keep `model` alive until a tab layout retains it: a file an edit touched
 *  (a rename across files) whose tab is being opened, so its unsaved edits
 *  survive until the tab holds it. */
export function holdUntilRetained(model: Model): void {
  const uri = model.uri.toString();
  const e = entries.get(uri);
  if (!e) return;
  for (const set of retained.values()) if (set.has(uri)) return;
  e.holders.add(UNTIL_RETAINED);
}

function isHeld(uri: string): boolean {
  const e = entries.get(uri);
  if (!e) return false;
  if (e.holders.size > 0) return true;
  for (const set of retained.values()) if (set.has(uri)) return true;
  return false;
}

function scheduleDispose(uri: string): void {
  setTimeout(() => {
    const e = entries.get(uri);
    if (!e || isHeld(uri)) return;
    entries.delete(uri);
    e.sub?.dispose();
    const wasDirty = e.saved?.dirty ?? false;
    if (e.saved) for (const l of workingListeners) l.closed(e.model);
    e.model.dispose();
    if (wasDirty) notify();
  }, 0);
}

// ── Save state ───────────────────────────────────────────────

/** The model now matches the disk (just loaded or written): at `versionId`,
 *  the version written, when edits may have landed since. */
export function markSaved(
  model: Model,
  stamp: DiskStamp,
  versionId = model.getAlternativeVersionId(),
): void {
  const e = entries.get(model.uri.toString());
  if (!e?.saved) return;
  e.saved.versionId = versionId;
  e.saved.stamp = stamp;
  updateDirty(e);
}

/** The disk stamp a save of `model` checks against. */
export function diskStamp(model: Model): DiskStamp | null {
  return entries.get(model.uri.toString())?.saved?.stamp ?? null;
}
