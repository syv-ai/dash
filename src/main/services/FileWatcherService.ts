import { BrowserWindow } from 'electron';
import chokidar from 'chokidar';

const DEBOUNCE_MS = 500;

/** Directories/patterns excluded at the filesystem level (no inotify watches created). */
const IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.DS_Store',
  '**/*.swp',
  '**/*~',
  '**/*.tmp',
];

interface WatcherEntry {
  watcher: chokidar.FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  cwd: string;
}

const watchers = new Map<string, WatcherEntry>();

/**
 * Start watching a directory for file changes.
 * Sends 'git:fileChanged' events to all renderer windows when changes detected.
 */
export function startWatching(id: string, cwd: string): void {
  // Don't double-watch
  if (watchers.has(id)) return;

  try {
    const watcher = chokidar.watch(cwd, {
      ignored: IGNORED,
      ignoreInitial: true,
      persistent: true,
    });

    const debouncedNotify = () => {
      const entry = watchers.get(id);
      if (!entry) return;

      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
      }

      entry.debounceTimer = setTimeout(() => {
        notifyRenderers(id);
        entry.debounceTimer = null;
      }, DEBOUNCE_MS);
    };

    watcher.on('change', debouncedNotify);
    watcher.on('add', debouncedNotify);
    watcher.on('unlink', debouncedNotify);

    watcher.on('error', () => {
      // Watcher errored — clean up silently
      stopWatching(id);
    });

    watchers.set(id, { watcher, debounceTimer: null, cwd });
  } catch {
    // Directory doesn't exist or can't be watched
  }
}

/**
 * Stop watching a directory.
 */
export function stopWatching(id: string): void {
  const entry = watchers.get(id);
  if (!entry) return;

  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }

  try {
    entry.watcher.close().catch(() => {});
  } catch {
    // Already closed
  }

  watchers.delete(id);
}

/**
 * Stop all watchers (on app quit).
 */
export function stopAll(): void {
  for (const [id] of watchers) {
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
