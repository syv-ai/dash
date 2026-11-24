import type { Database, Statement } from 'better-sqlite3';
import { getRawDb } from '../db/client';
import type { PrRef } from '@shared/types';

/** The PR files a task's reviewer marked viewed, each with the head blob it
 *  was viewed at. Whether a mark still holds (the blob at the current head
 *  matches) is the reader's call. */
export interface PrViewedFilesRepo {
  /** path → blob. */
  list(taskId: string, pr: PrRef): Record<string, string>;
  /** Mark `path` viewed at `blob`; null unmarks it. */
  set(taskId: string, pr: PrRef, path: string, blob: string | null): void;
}

/** The one owner of `pr_viewed_files` SQL. */
export function createPrViewedFilesRepo(db: Database): PrViewedFilesRepo {
  const s: Record<string, Statement> = {
    list: db.prepare(
      `SELECT path, blob FROM pr_viewed_files WHERE task_id = ? AND provider = ? AND number = ?`,
    ),
    put: db.prepare(
      `INSERT INTO pr_viewed_files (task_id, provider, number, path, blob, viewed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id, provider, number, path) DO UPDATE SET
          blob = excluded.blob, viewed_at = excluded.viewed_at`,
    ),
    clear: db.prepare(
      `DELETE FROM pr_viewed_files WHERE task_id = ? AND provider = ? AND number = ? AND path = ?`,
    ),
  };
  return {
    list(taskId, { provider, number }) {
      const rows = s.list!.all(taskId, provider, number) as { path: string; blob: string }[];
      return Object.fromEntries(rows.map((r) => [r.path, r.blob]));
    },
    set(taskId, { provider, number }, path, blob) {
      if (blob === null) s.clear!.run(taskId, provider, number, path);
      else s.put!.run(taskId, provider, number, path, blob, new Date().toISOString());
    },
  };
}

let repo: PrViewedFilesRepo | null = null;

/** The app's repo over its database. */
export function prViewedFilesRepo(): PrViewedFilesRepo {
  if (repo) return repo;
  const db = getRawDb();
  if (!db) throw new Error('db unavailable');
  repo = createPrViewedFilesRepo(db);
  return repo;
}
