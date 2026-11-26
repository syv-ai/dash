import * as fs from 'fs';
import * as path from 'path';

/** The folder itself, or its nearest existing ancestor; null when none exists. */
export function nearestExisting(dir: string): string | null {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(d)) return d;
    if (path.dirname(d) === d) return null;
  }
}

/**
 * Watch a folder and everything under it, calling `onChange` once events
 * settle. A folder that doesn't exist yet (or is deleted) is waited for: its
 * nearest existing ancestor is watched, without recursion, until it appears,
 * which counts as a change. `ignore` drops events for paths under the folder
 * (relative to it) that don't count. Never throws; returns `close`
 * (idempotent).
 */
export function watchFolder(
  dir: string,
  opts: { debounceMs: number; onChange: () => void; ignore?: (relPath: string) => boolean },
): () => void {
  let watcher: fs.FSWatcher | null = null;
  let watched: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!closed) opts.onChange();
    }, opts.debounceMs);
  };
  const disarm = () => {
    try {
      watcher?.close();
    } catch {
      // Already closed.
    }
    watcher = null;
    watched = null;
  };
  // Point the watch at the folder or its nearest ancestor. A rename is the
  // folder appearing or going: re-open, since a deleted folder's watch never
  // fires again.
  const arm = (force: boolean) => {
    if (closed) return;
    const target = nearestExisting(dir);
    if (!target || (!force && target === watched)) return;
    disarm();
    const own = target === dir;
    try {
      watcher = fs.watch(target, { recursive: own }, (event, filename) => {
        if (own && filename && opts.ignore?.(filename)) return;
        const before = watched;
        if (!own || event === 'rename') arm(false);
        if (own || watched !== before) schedule();
      });
      watcher.on('error', () => {
        disarm();
        arm(true);
        schedule();
      });
      watched = target;
    } catch (err) {
      console.warn('[watchFolder] fs.watch failed', target, err);
    }
  };

  arm(true);
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    disarm();
  };
}
