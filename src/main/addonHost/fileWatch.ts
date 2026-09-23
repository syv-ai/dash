import * as fs from 'fs';

export interface WatchOptions {
  debounceMs?: number;
  /** How often to retry while the directory doesn't exist (or vanished). */
  retryMs?: number;
}

/**
 * Watch a directory that may not exist yet. Calls `onChange` with the file
 * names that changed since the last call, debounced. Watches the directory, not
 * files, because editors save atomically (write tmp → rename) and fs.watch on a
 * missing path throws. While the directory is missing (or after it's removed),
 * retries every `retryMs`. Returns a disposer.
 */
export function watchDirectory(
  dir: string,
  onChange: (files: string[]) => void,
  opts: WatchOptions = {},
): () => void {
  const debounceMs = opts.debounceMs ?? 300;
  const retryMs = opts.retryMs ?? 2000;
  let watcher: fs.FSWatcher | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pending = new Set<string>();
  let disposed = false;

  const flush = () => {
    debounceTimer = null;
    const files = [...pending];
    pending = new Set();
    try {
      onChange(files);
    } catch (err) {
      console.error('[fileWatch] onChange failed', dir, err);
    }
  };

  const scheduleRetry = () => {
    if (disposed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      arm();
    }, retryMs);
  };

  const arm = () => {
    if (disposed || watcher) return;
    if (!fs.existsSync(dir)) {
      scheduleRetry();
      return;
    }
    try {
      watcher = fs.watch(dir, (_event, filename) => {
        if (filename) pending.add(filename.toString());
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flush, debounceMs);
        // The directory itself was removed: drop the watcher and wait for it to return.
        if (!fs.existsSync(dir)) {
          close();
          scheduleRetry();
        }
      });
      watcher.on('error', () => {
        close();
        scheduleRetry();
      });
    } catch {
      watcher = null;
      scheduleRetry();
    }
  };

  const close = () => {
    try {
      watcher?.close();
    } catch {
      /* already closed */
    }
    watcher = null;
  };

  arm();

  return () => {
    disposed = true;
    close();
    if (retryTimer) clearTimeout(retryTimer);
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}
