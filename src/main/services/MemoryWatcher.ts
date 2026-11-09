import * as fs from 'fs';
import * as path from 'path';
import { resolveMemoryDir } from './MemoryService';

// Claude writes a memory and then its MEMORY.md line in quick succession;
// one notification covers both.
const DEBOUNCE_MS = 300;

interface Watch {
  projectId: string;
  projectPath: string;
  memoryDir: string;
  watcher: fs.FSWatcher | null;
  watchedDir: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** What a project needs to have its memory watched. */
export interface WatchedProject {
  id: string;
  path: string;
}

// One watch per project, for as long as the project exists: the project row's
// "new memories" badge needs to hear of a memory whenever Claude writes it.
const watches = new Map<string, Watch>();
// Syncs run one after another, so two can't both add the same project.
let syncing: Promise<void> = Promise.resolve();
// Nothing is watched before startMemoryWatches (at app start), so a project
// saved earlier, or in a test, doesn't open watches.
let started = false;

let notify: (projectId: string, memoryDir: string) => void = () => {};

/** Who hears that a project's memory folder changed (memoryIpc broadcasts the new count). */
export function setMemoryChangeNotifier(fn: (projectId: string, memoryDir: string) => void): void {
  notify = fn;
}

/** The watched memory folder of a project, or undefined when it isn't watched. */
export function watchedMemoryDir(projectId: string): string | undefined {
  return watches.get(projectId)?.memoryDir;
}

/** The memory dir itself, or its nearest existing ancestor. */
function nearestExisting(dir: string): string | null {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(d)) return d;
    if (path.dirname(d) === d) return null;
  }
}

function isCurrent(entry: Watch): boolean {
  return watches.get(entry.projectId) === entry;
}

function schedule(entry: Watch): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (isCurrent(entry)) notify(entry.projectId, entry.memoryDir);
  }, DEBOUNCE_MS);
}

function disarm(entry: Watch): void {
  try {
    entry.watcher?.close();
  } catch {
    // already closed
  }
  entry.watcher = null;
  entry.watchedDir = null;
}

/**
 * Point the watch at the memory dir, or its nearest existing ancestor. `force`
 * re-opens it even on the same path: a deleted folder's watch never fires
 * again, and a recreated one can even reuse the inode, so only a fresh
 * `fs.watch` is reliable.
 */
function arm(entry: Watch, force = false): void {
  const target = nearestExisting(entry.memoryDir);
  if (!target || (!force && target === entry.watchedDir)) return;
  disarm(entry);
  try {
    const watcher = fs.watch(target, (event) => {
      if (!isCurrent(entry)) return;
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
      if (!isCurrent(entry) || entry.watcher !== watcher) return;
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

function close(entry: Watch): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  disarm(entry);
}

async function sync(projects: WatchedProject[]): Promise<void> {
  const wanted = new Map(projects.map((p) => [p.id, p.path]));
  for (const [id, entry] of watches) {
    if (wanted.get(id) === entry.projectPath) continue;
    close(entry);
    watches.delete(id);
  }
  for (const [projectId, projectPath] of wanted) {
    if (watches.has(projectId)) continue;
    let memoryDir: string;
    try {
      memoryDir = await resolveMemoryDir(projectPath);
    } catch (err) {
      console.warn('[MemoryWatcher] cannot resolve memory folder', projectPath, err);
      continue;
    }
    const entry: Watch = {
      projectId,
      projectPath,
      memoryDir,
      watcher: null,
      watchedDir: null,
      timer: null,
    };
    watches.set(projectId, entry);
    arm(entry);
  }
}

/** Start watching: from now on, syncs take effect. Called once at app start. */
export function startMemoryWatches(projects: WatchedProject[]): Promise<void> {
  started = true;
  return syncMemoryWatches(projects);
}

/**
 * Watch the memory folder of each of `projects` (one `fs.watch` apiece, on
 * the folder or, until it exists, its nearest existing ancestor), and stop
 * watching projects no longer listed. DatabaseService calls it on every
 * project save and delete. A no-op before startMemoryWatches.
 */
export function syncMemoryWatches(projects: WatchedProject[]): Promise<void> {
  if (!started) return syncing;
  syncing = syncing
    .then(() => sync(projects))
    .catch((err) => console.error('[MemoryWatcher] sync failed', err));
  return syncing;
}

/** Close every watch. Idempotent; called at quit. */
export function stopAllMemoryWatches(): void {
  started = false;
  for (const entry of watches.values()) close(entry);
  watches.clear();
}
