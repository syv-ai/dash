import * as fs from 'fs';

export interface WatchDirOptions {
  /** Which events count. Events without a filename are dropped when a filter is set. */
  filter?: (filename: string, eventType: fs.WatchEventType) => boolean;
  /** Quiet time after the last matching event before onChange runs. */
  debounceMs: number;
  onChange: () => void;
}

/**
 * Watch one directory (non-recursively) and call `onChange` once events settle.
 * Watching the folder rather than a file survives atomic saves (write tmp →
 * rename) and files that don't exist yet. A watch error (the folder deleted
 * under us) is swallowed; the watch just goes quiet.
 *
 * Throws if `fs.watch` can't open the folder (e.g. it doesn't exist), so the
 * caller decides whether that's an error or a retry later. Returns `close`,
 * which also cancels a pending onChange. Idempotent.
 */
export function watchDir(dir: string, opts: WatchDirOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watcher = fs.watch(dir, (eventType, filename) => {
    if (opts.filter && (!filename || !opts.filter(filename, eventType))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      opts.onChange();
    }, opts.debounceMs);
  });
  watcher.on('error', () => {});
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      watcher.close();
    } catch {
      // Already closed.
    }
  };
}
