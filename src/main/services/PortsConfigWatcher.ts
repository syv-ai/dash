import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { WorkspacePortsRuntime } from './WorkspacePortsRuntime';

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
  watcher: fs.FSWatcher;
  worktreePath: string;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  sentinelDebounceTimer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, WatcherEntry>();

/**
 * Watch the task's `.dash/` directory for changes to `ports.json`. On any
 * create / modify / delete, debounce 2s, then re-run setupTask (which
 * handles all three cases — clears DB + removes ports.env when the file is
 * gone, re-allocates when it's there) and broadcast `ports:configChanged`
 * so the drawer re-fetches.
 *
 * Watches the parent directory rather than the file itself because:
 *   1. fs.watch on a non-existent file errors immediately, so it's harder
 *      to arm before ports.json exists.
 *   2. Editors save atomically (write tmp → rename), which leaves the
 *      file-watch's inode pointing at the old, deleted file on macOS.
 *
 * Skips entirely if `.dash/` doesn't exist yet. The IPC layer (db:saveTask,
 * ports:refresh) re-arms after setupTask creates the directory, so the
 * watcher is in place once there's actually something to watch.
 */
export function startWatching(taskId: string, worktreePath: string): void {
  if (entries.has(taskId)) return;

  const dashDir = path.join(worktreePath, DASH_DIR);
  if (!fs.existsSync(dashDir)) return;

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dashDir, (_eventType, filename) => {
      if (filename === PORTS_FILE) {
        const entry = entries.get(taskId);
        if (!entry) return;
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = null;
          try {
            WorkspacePortsRuntime.setupTask({ taskId, worktreePath });
          } catch (err) {
            console.error('[PortsConfigWatcher] setupTask failed:', err);
          }
          notifyConfigChanged(taskId);
        }, DEBOUNCE_MS);
        return;
      }
      if (filename === SETUP_COMPLETE_FILE) {
        const entry = entries.get(taskId);
        if (!entry) return;
        // Only fire when the file actually EXISTS post-event — the agent
        // is told to delete the stale sentinel at the start of work, and
        // we don't want that deletion to trigger the "agent done" path.
        const sentinelPath = path.join(dashDir, SETUP_COMPLETE_FILE);
        if (!fs.existsSync(sentinelPath)) return;
        if (entry.sentinelDebounceTimer) clearTimeout(entry.sentinelDebounceTimer);
        entry.sentinelDebounceTimer = setTimeout(() => {
          entry.sentinelDebounceTimer = null;
          notifySetupComplete(taskId);
        }, DEBOUNCE_MS);
      }
    });
  } catch (err) {
    console.error(
      `[PortsConfigWatcher] failed to watch ${dashDir}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // .dash dir may vanish if the user deletes the worktree out from under us;
  // suppress unhandled-error logs in that case.
  watcher.on('error', () => {});

  entries.set(taskId, {
    watcher,
    worktreePath,
    debounceTimer: null,
    sentinelDebounceTimer: null,
  });
}

export function stopWatching(taskId: string): void {
  const entry = entries.get(taskId);
  if (!entry) return;
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  if (entry.sentinelDebounceTimer) clearTimeout(entry.sentinelDebounceTimer);
  try {
    entry.watcher.close();
  } catch {
    // Already closed.
  }
  entries.delete(taskId);
}

export function stopAll(): void {
  for (const id of Array.from(entries.keys())) stopWatching(id);
}

function notifyConfigChanged(taskId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('ports:configChanged', { taskId });
    }
  }
}

function notifySetupComplete(taskId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('ports:setupComplete', { taskId });
    }
  }
}
