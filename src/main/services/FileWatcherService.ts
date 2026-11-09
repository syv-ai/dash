import * as path from 'path';
import { broadcast } from '../utils/broadcast';
import { watchDir } from '../utils/watchDir';

const DEBOUNCE_MS = 500;

/** Only these git internals need watching to detect status changes. */
const GIT_WATCH_FILES = ['index', 'HEAD', 'MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD'];

interface WatcherEntry {
  close: () => void;
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
  // The .git dir may vanish later (e.g. repo deleted); watchDir swallows that error.
  const close = watchDir(gitDir, {
    filter: (filename) => GIT_WATCH_FILES.includes(filename),
    debounceMs: DEBOUNCE_MS,
    onChange: () => notifyRenderers(id),
  });

  entries.set(id, { close, cwd });
}

/**
 * Stop watching a directory.
 */
export function stopWatching(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;
  entry.close();
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
  broadcast('git:fileChanged', id);
}
