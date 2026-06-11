import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { WorkspacePortsRuntime } from './WorkspacePortsRuntime';
import { portsDebug } from './PortsDebugLog';

/**
 * In-process event bus for main-side consumers (e.g. PortsSetupWizard)
 * that need the same notifications the renderer gets via IPC. Emits:
 *   - 'ports:config'        with { taskId } when ports.json changes
 *   - 'ports:setupComplete' with { taskId } when the sentinel exists
 */
export const events = new EventEmitter();

// 2s debounce — ports.json changes are infrequent (the agent writes once
// during setup, the user edits rarely). Slow-rolling is fine; this also
// absorbs editor save patterns that emit multiple events per save.
const DEBOUNCE_MS = 2000;
const DASH_DIR = '.dash';
const PORTS_FILE = 'ports.json';
// Sentinel written by the slash command body as its last action. Watched
// so the renderer can defer the "Restart session" toast until the agent
// has actually finished — ports.json appears mid-flow, but the agent
// keeps working on docs, wiring, and AskUserQuestion rounds for minutes
// after that, and restarting at the wrong moment kills the in-flight work.
const SETUP_COMPLETE_FILE = 'setup-complete';

interface WatcherEntry {
  // null when ensureWatching ran before .dash/ existed; every subsequent
  // ensureWatching call retries the arm, so the watcher comes online as soon
  // as the directory appears.
  watcher: fs.FSWatcher | null;
  worktreePath: string;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  sentinelDebounceTimer: ReturnType<typeof setTimeout> | null;
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
    entry = { watcher: null, worktreePath, debounceTimer: null, sentinelDebounceTimer: null };
    entries.set(taskId, entry);
  }
  if (!entry.watcher) armWatcher(entry, taskId);
}

function armWatcher(entry: WatcherEntry, taskId: string): void {
  const dashDir = path.join(entry.worktreePath, DASH_DIR);
  if (!fs.existsSync(dashDir)) {
    portsDebug.log('watcher', 'armWatcher: .dash missing — deferred', { taskId, dashDir });
    return;
  }

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dashDir, (eventType, filename) => {
      portsDebug.log('watcher', 'fs.watch event', { taskId, eventType, filename });
      if (filename === PORTS_FILE) {
        const e = entries.get(taskId);
        if (!e) return;
        if (e.debounceTimer) clearTimeout(e.debounceTimer);
        e.debounceTimer = setTimeout(() => {
          e.debounceTimer = null;
          try {
            WorkspacePortsRuntime.setupTask({ taskId, worktreePath: entry.worktreePath });
          } catch (err) {
            portsDebug.log('watcher', 'setupTask failed', { taskId, err: String(err) });
          }
          notifyConfigChanged(taskId);
        }, DEBOUNCE_MS);
        return;
      }
      if (filename === SETUP_COMPLETE_FILE) {
        const e = entries.get(taskId);
        if (!e) return;
        const sentinelPath = path.join(dashDir, SETUP_COMPLETE_FILE);
        const exists = fs.existsSync(sentinelPath);
        portsDebug.log('watcher', 'sentinel event', { taskId, exists });
        if (!exists) return;
        if (e.sentinelDebounceTimer) clearTimeout(e.sentinelDebounceTimer);
        e.sentinelDebounceTimer = setTimeout(() => {
          e.sentinelDebounceTimer = null;
          notifySetupComplete(taskId);
        }, DEBOUNCE_MS);
      }
    });
  } catch (err) {
    portsDebug.log('watcher', 'fs.watch threw', { taskId, err: String(err) });
    return;
  }

  // .dash dir may vanish if the user deletes the worktree out from under us;
  // suppress unhandled-error logs in that case.
  watcher.on('error', () => {});

  entry.watcher = watcher;
  portsDebug.log('watcher', 'armWatcher: armed', { taskId, dashDir });
}

/** Close the watcher and drop the entry. For task deletion. Idempotent. */
export function stop(taskId: string): void {
  const entry = entries.get(taskId);
  if (!entry) return;
  closeEntry(entry);
  entries.delete(taskId);
  portsDebug.log('watcher', 'stop: closed', { taskId });
}

export function stopAll(): void {
  for (const [taskId, entry] of Array.from(entries.entries())) {
    closeEntry(entry);
    entries.delete(taskId);
  }
}

function closeEntry(entry: WatcherEntry): void {
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  if (entry.sentinelDebounceTimer) clearTimeout(entry.sentinelDebounceTimer);
  if (entry.watcher) {
    try {
      entry.watcher.close();
    } catch {
      // Already closed.
    }
  }
}

function notifyConfigChanged(taskId: string): void {
  portsDebug.log('watcher', 'emit ports:config', { taskId });
  events.emit('ports:config', { taskId });
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('ports:configChanged', { taskId });
    }
  }
}

function notifySetupComplete(taskId: string): void {
  portsDebug.log('watcher', 'emit ports:setupComplete', { taskId });
  events.emit('ports:setupComplete', { taskId });
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('ports:setupComplete', { taskId });
    }
  }
}
