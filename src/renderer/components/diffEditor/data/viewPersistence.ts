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
