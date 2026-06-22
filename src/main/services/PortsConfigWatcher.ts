import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { WorkspacePortsRuntime } from './WorkspacePortsRuntime';

/**
 * In-process event bus for main-side consumers (e.g. PortsSetupWizard)
 * that need the same notifications the renderer gets via IPC. Emits:
 *   - 'ports:config'        with { taskId } when ports.json is valid
 *   - 'ports:configError'   with { taskId, errors } when ports.json is invalid
 */
export const events = new EventEmitter();

// 2s debounce — ports.json changes are infrequent (the agent writes once
// during setup, the user edits rarely). Slow-rolling is fine; this also
// absorbs editor save patterns that emit multiple events per save.
const DEBOUNCE_MS = 2000;
const DASH_DIR = '.dash';
const PORTS_FILE = 'ports.json';

interface WatcherEntry {
  // null when ensureWatching ran before .dash/ existed; every subsequent
  // ensureWatching call retries the arm, so the watcher comes online as soon
  // as the directory appears.
  watcher: fs.FSWatcher | null;
  worktreePath: string;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, WatcherEntry>();

/**
 * Watch the task's `.dash/` directory for changes to `ports.json` and the
 * setup-complete sentinel. On any create / modify / delete of ports.json,
 * debounce 2s, then re-run setupTask (which clears DB rows when the file is
 * gone and re-allocates when it's there) and broadcast `ports:configChanged`
 * so the drawer re-fetches.
 *
 * Idempotent: safe to call from any code path that merely wants the watcher
 * up (task creation, drawer mount, refresh click, orchestrated setup). A
 * watcher lives for its task's lifetime — `stop` is called on task deletion,
 * `stopAll` at quit. There is no per-caller bookkeeping; agent edits keep
 * SQLite fresh with no drawer open by design.
 *
 * Watches the parent directory rather than the file itself because:
 *   1. fs.watch on a non-existent file errors immediately, so it's harder
 *      to arm before ports.json exists.
 *   2. Editors save atomically (write tmp → rename), which leaves the
 *      file-watch's inode pointing at the old, deleted file on macOS.
 */
export function ensureWatching(taskId: string, worktreePath: string): void {
  let entry = entries.get(taskId);
  if (!entry) {
    entry = { watcher: null, worktreePath, debounceTimer: null };
    entries.set(taskId, entry);
  }
  if (!entry.watcher) armWatcher(entry, taskId);
}

function armWatcher(entry: WatcherEntry, taskId: string): void {
  const dashDir = path.join(entry.worktreePath, DASH_DIR);
  // Deferred until .dash/ exists — ensureWatching retries the arm on its next call.
  if (!fs.existsSync(dashDir)) return;

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dashDir, (eventType, filename) => {
      if (filename === PORTS_FILE) {
        const e = entries.get(taskId);
        if (!e) return;
        if (e.debounceTimer) clearTimeout(e.debounceTimer);
        e.debounceTimer = setTimeout(() => {
          e.debounceTimer = null;
          const errors: string[] = [];
          try {
            WorkspacePortsRuntime.setupTask({ taskId, worktreePath: entry.worktreePath }, errors);
          } catch (err) {
            console.error('[PortsConfigWatcher] setupTask failed', taskId, err);
            errors.push(err instanceof Error ? err.message : String(err));
          }
          notifyConfigChanged(taskId, errors);
        }, DEBOUNCE_MS);
        return;
      }
    });
  } catch (err) {
    console.error('[PortsConfigWatcher] fs.watch failed', taskId, err);
    return;
  }

  // .dash dir may vanish if the user deletes the worktree out from under us;
  // suppress unhandled-error logs in that case.
  watcher.on('error', () => {});

  entry.watcher = watcher;
}

/** Close the watcher and drop the entry. For task deletion. Idempotent. */
export function stop(taskId: string): void {
  const entry = entries.get(taskId);
  if (!entry) return;
  closeEntry(entry);
  entries.delete(taskId);
}

export function stopAll(): void {
  for (const [taskId, entry] of Array.from(entries.entries())) {
    closeEntry(entry);
    entries.delete(taskId);
  }
}

function closeEntry(entry: WatcherEntry): void {
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  if (entry.watcher) {
    try {
      entry.watcher.close();
    } catch {
      // Already closed.
    }
  }
}

function notifyConfigChanged(taskId: string, errors: string[]): void {
  // The renderer panel refreshes either way — setupTask re-applied the DB
  // rows (or cleared them on an invalid config), and the panel reads from DB.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('ports:configChanged', { taskId });
    }
  }
  // In-process: a valid config advances the setup wizard; an invalid one keeps
  // it waiting and shows the errors, so a corrected rewrite re-advances it.
  if (errors.length > 0) {
    events.emit('ports:configError', { taskId, errors });
  } else {
    events.emit('ports:config', { taskId });
  }
}
