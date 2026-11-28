import * as fs from 'fs';
import * as path from 'path';
import { broadcast } from '../utils/broadcast';
import { watchDir } from '../utils/watchDir';
import { hasGit } from '../utils/gitPresence';

const DEBOUNCE_MS = 500;

/** Only these git internals need watching to detect status changes: the
 *  checkout's own (a worktree's are in its private git dir), and FETCH_HEAD,
 *  which a fetch writes there too, for ahead/behind. */
const GIT_WATCH_FILES = [
  'index',
  'HEAD',
  'MERGE_HEAD',
  'REBASE_HEAD',
  'CHERRY_PICK_HEAD',
  'FETCH_HEAD',
];
/** And in the repository's common dir: the refs every worktree shares, once packed. */
const COMMON_WATCH_FILES = ['packed-refs'];

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
  // A plain folder has no git to watch (the project's git presence watch
  // tells the renderer if it gains one).
  if (entries.has(id) || !hasGit(cwd)) return;

  const { gitDir, commonDir } = resolveGitDirs(cwd);
  const onChange = () => notifyRenderers(id);

  // Watch the git directory itself (non-recursively) instead of individual files.
  // Git updates files atomically (write tmp → rename), which breaks per-file watchers
  // on macOS since the watcher follows the old inode. Watching the directory works on
  // both platforms and automatically picks up files created later (e.g. MERGE_HEAD).
  // The git dir may vanish later (e.g. repo deleted); watchDir swallows that error.
  const watch = (dir: string, names: string[]) =>
    watchDir(dir, {
      filter: (filename) => names.includes(filename),
      debounceMs: DEBOUNCE_MS,
      onChange,
    });

  if (commonDir === gitDir) {
    const close = watch(gitDir, [...GIT_WATCH_FILES, ...COMMON_WATCH_FILES]);
    entries.set(id, { close, cwd });
    return;
  }
  const closers = [watch(gitDir, GIT_WATCH_FILES)];
  try {
    closers.push(watch(commonDir, COMMON_WATCH_FILES));
  } catch {
    // The checkout's own dir is watched; the shared one only adds packed refs.
  }
  entries.set(id, { close: () => closers.forEach((close) => close()), cwd });
}

/**
 * The git dirs behind a checkout at `cwd`. In a main checkout `.git` is the
 * folder holding both. In a linked worktree `.git` is a file (`gitdir: <path>`)
 * pointing at the worktree's private dir (its index, HEAD, FETCH_HEAD), whose
 * `commondir` file points at the repository's shared one (refs, packed-refs).
 * Falls back to `<cwd>/.git` for both when the file can't be read.
 */
export function resolveGitDirs(cwd: string): { gitDir: string; commonDir: string } {
  const dotGit = path.join(cwd, '.git');
  let gitDir = dotGit;
  try {
    if (fs.statSync(dotGit).isFile()) {
      const match = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
      if (match) gitDir = path.resolve(cwd, match[1]!);
    }
  } catch {
    // No .git yet, or unreadable: watch where it would be.
  }
  let commonDir = gitDir;
  try {
    commonDir = path.resolve(
      gitDir,
      fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim(),
    );
  } catch {
    // A main checkout's git dir is its own common dir.
  }
  return { gitDir, commonDir };
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
