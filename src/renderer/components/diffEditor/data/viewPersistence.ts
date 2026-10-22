import type { EditorView } from '../types';

// Per-repo last-open view, so reopening the editor lands back where the user
// left off (a commit, a branch comparison, a PR under review, or the working
// tree) instead of always resetting to working. Keyed by cwd because each task worktree has its
// own history. Renderer-only, like the other diff-editor UI prefs.
const keyFor = (cwd: string) => `diffEditor.view:${cwd}`;
const fileKeyFor = (cwd: string) => `diffEditor.file:${cwd}`;

/** Validate an unknown value into an EditorView, or null if it doesn't match
 *  the discriminated-union shape. Pure so it can be unit-tested directly. */
export function parseStoredView(raw: string | null): EditorView | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (o.kind === 'working' && (o.ref === 'HEAD' || o.ref === 'index')) {
    return { kind: 'working', ref: o.ref };
  }
  if (o.kind === 'commit' && typeof o.hash === 'string' && o.hash) {
    // A symbolic ref isn't a pinned commit (older builds used 'HEAD' as a
    // "latest commit" placeholder) — the working tree is the right default.
    if (o.hash === 'HEAD') return null;
    return { kind: 'commit', hash: o.hash };
  }
  if (o.kind === 'branch' && typeof o.base === 'string' && o.base) {
    return { kind: 'branch', base: o.base };
  }
  if (
    o.kind === 'pr' &&
    (o.provider === 'github' || o.provider === 'ado') &&
    typeof o.number === 'number' &&
    typeof o.base === 'string' &&
    typeof o.head === 'string' &&
    o.base &&
    o.head
  ) {
    return { kind: 'pr', provider: o.provider, number: o.number, base: o.base, head: o.head };
  }
  return null;
}

export function readStoredView(cwd: string): EditorView | null {
  try {
    return parseStoredView(localStorage.getItem(keyFor(cwd)));
  } catch {
    return null;
  }
}

export function writeStoredView(cwd: string, view: EditorView): void {
  try {
    localStorage.setItem(keyFor(cwd), JSON.stringify(view));
  } catch {
    // Storage full / unavailable — persistence is best-effort.
  }
}

/** The file last open in the editor, so a restored view reopens on it. */
export function readStoredFile(cwd: string): string {
  try {
    return localStorage.getItem(fileKeyFor(cwd)) ?? '';
  } catch {
    return '';
  }
}

export function writeStoredFile(cwd: string, path: string): void {
  try {
    if (path) localStorage.setItem(fileKeyFor(cwd), path);
  } catch {
    // Best-effort, like the view.
  }
}

/** Where "Open in editor" lands. */
export interface EditorOpening {
  filePath: string;
  staged: boolean;
  /** A PR view or the working tree. Absent: the editor restores the repo's
   *  last view itself. */
  initialView?: Extract<EditorView, { kind: 'pr' | 'working' }>;
}

/**
 * Where "Open in editor" lands, from the stored view and the working changes.
 * A review in progress outranks the changes: a stored PR view reopens on the
 * file left open. Otherwise the first unstaged change (else the first staged).
 * With no changes, still the working tree, not the last commit: the editor is
 * only editable there, and a save shows up as an unstaged change.
 */
export function openingFor(
  stored: EditorView | null,
  storedFile: string,
  files: ReadonlyArray<{ path: string; staged: boolean }>,
): EditorOpening {
  if (stored?.kind === 'pr') return { filePath: storedFile, staged: false, initialView: stored };
  const target = files.find((f) => !f.staged) ?? files[0];
  if (target) return { filePath: target.path, staged: target.staged };
  return { filePath: '', staged: false, initialView: { kind: 'working', ref: 'HEAD' } };
}

/** `openingFor` over the repo's stored view and file. */
export function editorOpening(
  cwd: string,
  files: ReadonlyArray<{ path: string; staged: boolean }>,
): EditorOpening {
  return openingFor(readStoredView(cwd), readStoredFile(cwd), files);
}
