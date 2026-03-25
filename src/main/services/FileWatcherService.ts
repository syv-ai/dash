import * as path from 'path';
import { BrowserWindow } from 'electron';
import * as fs from 'fs';

const DEBOUNCE_MS = 500;

/** Only these git internals need watching to detect status changes. */
const GIT_WATCH_FILES = ['index', 'HEAD', 'MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD'];

interface WatcherEntry {
  watchers: fs.FSWatcher[];
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
  const fsWatchers: fs.FSWatcher[] = [];
  const entry: WatcherEntry = { watchers: fsWatchers, debounceTimer: null, cwd };
  entries.set(id, entry);

  const debouncedNotify = () => {
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
    }
    entry.debounceTimer = setTimeout(() => {
      notifyRenderers(id);
      entry.debounceTimer = null;
    }, DEBOUNCE_MS);
  };

  for (const file of GIT_WATCH_FILES) {
    const filePath = path.join(gitDir, file);
    try {
      const watcher = fs.watch(filePath, debouncedNotify);
      watcher.on('error', () => {}); // File may not exist (e.g. MERGE_HEAD)
      fsWatchers.push(watcher);
    } catch {
      // File doesn't exist yet — that's fine
    }
  }
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

  for (const w of entry.watchers) {
    try {
      w.close();
    } catch {
      // Already closed
    }
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
