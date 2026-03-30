import * as path from 'path';
import { BrowserWindow } from 'electron';
import * as fs from 'fs';

const DEBOUNCE_MS = 500;

/** Only these git internals need watching to detect status changes. */
const GIT_WATCH_FILES = ['index', 'HEAD', 'MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD'];

interface WatcherEntry {
  watcher: fs.FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  cwd: string;
}

const entries = new Map<string, WatcherEntry>();

/**
 * Start watching a directory's .git internals for state changes.
 * Sends 'git:fileChanged' events to all renderer windows when changes detected.
 */
export function startWatching(id: string, cwd: string): void {
  if (entries.has(id)) return;

  const gitDir = path.join(cwd, '.git');

  // Watch the .git directory itself (non-recursively) instead of individual files.
  // Git updates files atomically (write tmp → rename), which breaks per-file watchers
  // on macOS since the watcher follows the old inode. Watching the directory works on
  // both platforms and automatically picks up files created later (e.g. MERGE_HEAD).
  const watcher = fs.watch(gitDir, (_eventType, filename) => {
    if (!filename || !GIT_WATCH_FILES.includes(filename)) return;

    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
    }
    entry.debounceTimer = setTimeout(() => {
      notifyRenderers(id);
      entry.debounceTimer = null;
    }, DEBOUNCE_MS);
  });

  watcher.on('error', () => {}); // .git dir may vanish (e.g. repo deleted)

  const entry: WatcherEntry = { watcher, debounceTimer: null, cwd };
  entries.set(id, entry);
}

/**
 * Stop watching a directory.
 */
export function stopWatching(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;

  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }

  try {
    entry.watcher.close();
  } catch {
    // Already closed
  }

  entries.delete(id);
}

/**
 * Stop all watchers (on app quit).
 */
export function stopAll(): void {
  for (const [id] of entries) {
    stopWatching(id);
  }
}

/**
 * Notify all renderer windows that files changed for a given watcher ID.
 */
function notifyRenderers(id: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('git:fileChanged', id);
    }
  }
}
