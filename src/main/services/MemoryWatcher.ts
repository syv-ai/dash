import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { resolveMemoryDir } from './MemoryService';

// Claude writes a memory and then its MEMORY.md line in quick succession;
// one refresh covers both.
const DEBOUNCE_MS = 300;

interface ActiveWatch {
  projectPath: string;
  memoryDir: string;
  watcher: fs.FSWatcher | null;
  watchedDir: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

// One watch at a time: it exists only while the memory modal is open, and the
// modal shows one project.
let active: ActiveWatch | null = null;
// Bumped by every watch/stop so an await that resolves late can't arm a
// watcher for a modal that has since closed or switched project.
let generation = 0;

let notify = (projectPath: string): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('memory:changed', projectPath);
  }
};

/** Test seam: replace the renderer broadcast. */
export function setMemoryChangeNotifier(fn: (projectPath: string) => void): void {
  notify = fn;
}

/** The memory dir itself, or its nearest existing ancestor. */
function nearestExisting(dir: string): string | null {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(d)) return d;
    if (path.dirname(d) === d) return null;
  }
}

function schedule(entry: ActiveWatch): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    notify(entry.projectPath);
  }, DEBOUNCE_MS);
}

function disarm(entry: ActiveWatch): void {
  entry.watcher?.close();
  entry.watcher = null;
  entry.watchedDir = null;
}

/**
 * Point the watch at the memory dir, or its nearest existing ancestor. `force`
 * re-opens it even on the same path: a deleted folder's watch never fires
 * again, and a recreated one can even reuse the inode, so only a fresh
 * `fs.watch` is reliable.
 */
function arm(entry: ActiveWatch, force = false): void {
  const target = nearestExisting(entry.memoryDir);
  if (!target || (!force && target === entry.watchedDir)) return;
  disarm(entry);
  try {
    const watcher = fs.watch(target, (event) => {
      if (active !== entry) return;
      const before = entry.watchedDir;
      // 'rename' covers memory/ appearing under an ancestor and the watched
      // folder itself being deleted.
      arm(entry, event === 'rename');
      // An ancestor is usually the project's transcript folder, written on
      // every turn: only the watch moving (memory/ appearing) matters there.
      if (entry.watchedDir === entry.memoryDir || entry.watchedDir !== before) schedule(entry);
    });
    watcher.on('error', (err) => {
      console.warn('[MemoryWatcher] watch lost; re-arming', target, err);
      if (active !== entry || entry.watcher !== watcher) return;
      disarm(entry);
      arm(entry);
      schedule(entry);
    });
    entry.watcher = watcher;
    entry.watchedDir = target;
  } catch (err) {
    console.error('[MemoryWatcher] fs.watch failed', target, err);
  }
}

/** Watch `projectPath`'s memory folder, replacing any previous watch. */
export async function watchProjectMemory(projectPath: string): Promise<void> {
  stopWatchingMemory();
  const mine = ++generation;
  const memoryDir = await resolveMemoryDir(projectPath);
  if (mine !== generation) return;
  active = { projectPath, memoryDir, watcher: null, watchedDir: null, timer: null };
  arm(active);
  // Later re-arms only log; a watch that can't start at all (e.g. ENOSPC, out
  // of inotify watches) is reported so the modal can say it isn't live.
  if (!active.watcher) throw new Error(`Could not watch ${memoryDir} for changes`);
}

/** Close the watch. Idempotent; also called at quit. */
export function stopWatchingMemory(): void {
  generation++;
  if (!active) return;
  if (active.timer) clearTimeout(active.timer);
  try {
    active.watcher?.close();
  } catch {
    // already closed
  }
  active = null;
}
