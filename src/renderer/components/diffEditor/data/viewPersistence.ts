import type { EditorView } from '../types';

// Per-repo last-open view, so reopening the editor lands back where the user
// left off (a commit, or the working tree) instead of always resetting to
// working. A PR's view isn't restored: review mode shows it afresh, and out
// of review mode there is none. Views of a retired kind (`branch`) read as
// none, so the working tree. Keyed by cwd because each task worktree has its
// own history. Renderer-only, like the other diff-editor UI prefs.
const keyFor = (cwd: string) => `diffEditor.view:${cwd}`;

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
