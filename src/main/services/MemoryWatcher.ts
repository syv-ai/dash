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

function arm(entry: ActiveWatch): void {
  const target = nearestExisting(entry.memoryDir);
  if (!target || target === entry.watchedDir) return;
  entry.watcher?.close();
  entry.watcher = null;
  entry.watchedDir = null;
  try {
    entry.watcher = fs.watch(target, () => {
      // Watching an ancestor: re-aim at the memory dir once it exists.
      if (entry.watchedDir !== entry.memoryDir) arm(entry);
      schedule(entry);
    });
    entry.watcher.on('error', () => {}); // the folder may be deleted under us
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
