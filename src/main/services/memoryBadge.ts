import { BrowserWindow } from 'electron';
import { DatabaseService } from './DatabaseService';
import { newMemoryCount, resolveMemoryDir } from './MemoryService';
import { setMemoryChangeNotifier, syncMemoryWatches, watchedMemoryDir } from './MemoryWatcher';

/**
 * The project row's "N new memories" badge: memories written since the
 * project's memory modal was last opened, kept live by MemoryWatcher.
 */

function broadcastNewCount(projectId: string, count: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('memory:newCount', { projectId, count });
  }
}

/** At startup: watch every project's memory, and push its count to the renderer on each change. */
export function startMemoryBadges(): Promise<void> {
  setMemoryChangeNotifier((projectId, memoryDir) => {
    void newMemoryCount(memoryDir, DatabaseService.getMemorySeenAt(projectId)).then((count) =>
      broadcastNewCount(projectId, count),
    );
  });
  return syncProjectMemoryWatches();
}

/** Watch the memory of every project in the DB, and only those. After a project is added or removed. */
export function syncProjectMemoryWatches(): Promise<void> {
  return syncMemoryWatches(DatabaseService.getProjects());
}

/** Every project's new-memory count, by project id. */
export async function newMemoryCounts(): Promise<Record<string, number>> {
  const projects = DatabaseService.getProjects();
  const counts = await Promise.all(
    projects.map(async (p) => {
      const dir = watchedMemoryDir(p.id) ?? (await resolveMemoryDir(p.path));
      return [p.id, await newMemoryCount(dir, DatabaseService.getMemorySeenAt(p.id))] as const;
    }),
  );
  return Object.fromEntries(counts);
}

/** The project's memory was just looked at: nothing in it is new any more. */
export function markMemorySeen(projectId: string): void {
  DatabaseService.setMemorySeenAt(projectId, Date.now());
}
