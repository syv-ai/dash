import type { Project } from '@shared/types';
import { watchDir } from '../utils/watchDir';

/** Quiet time after `.git` comes or goes: `git init` writes it in one burst. */
const DEBOUNCE_MS = 500;

type WatchedProject = Pick<Project, 'id' | 'path' | 'archivedAt'>;

const watches = new Map<string, { path: string; close: () => void }>();
let onChange: ((projectId: string) => void) | null = null;

/**
 * Follow whether each project's folder holds `.git` while Dash runs (a plain
 * folder `git init`ed, a repository's `.git` removed): one non-recursive
 * `fs.watch` on the project's folder per project, telling `handler` when its
 * `.git` entry comes or goes. Archived projects aren't followed. Called once
 * at app start; `migrate` re-reads every project's `.git` at each start.
 */
export function startGitPresenceWatches(
  projects: WatchedProject[],
  handler: (projectId: string) => void,
): void {
  onChange = handler;
  syncGitPresenceWatches(projects);
}

/**
 * Watch each of `projects` (unarchived) and stop watching the rest.
 * DatabaseService calls it on every project save, delete and archive. A
 * no-op before startGitPresenceWatches.
 */
export function syncGitPresenceWatches(projects: WatchedProject[]): void {
  if (!onChange) return;
  const wanted = new Map(projects.filter((p) => !p.archivedAt).map((p) => [p.id, p.path]));
  for (const [id, entry] of watches) {
    if (wanted.get(id) === entry.path) continue;
    entry.close();
    watches.delete(id);
  }
  for (const [id, dir] of wanted) {
    if (watches.has(id)) continue;
    try {
      const close = watchDir(dir, {
        filter: (name) => name === '.git',
        debounceMs: DEBOUNCE_MS,
        onChange: () => onChange?.(id),
      });
      watches.set(id, { path: dir, close });
    } catch {
      // The folder is missing: the next sync tries again.
    }
  }
}

/** Close every watch. Idempotent; called at quit. */
export function stopGitPresenceWatches(): void {
  onChange = null;
  for (const entry of watches.values()) entry.close();
  watches.clear();
}
