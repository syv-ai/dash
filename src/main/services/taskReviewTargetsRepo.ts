import type { Database, Statement } from 'better-sqlite3';
import { getRawDb } from '../db/client';
import type { PrRef } from '@shared/types';

/** The PR a task is in review mode for (the sidebar's PR button), until the
 *  person exits it or it stops being relevant (see `settleReviewMode`). */
export interface TaskReviewTargetsRepo {
  get(taskId: string): PrRef | null;
  /** Null clears it (review mode exited or ended). */
  set(taskId: string, target: PrRef | null): void;
}

/** The one owner of `task_review_targets` SQL. */
export function createTaskReviewTargetsRepo(db: Database): TaskReviewTargetsRepo {
  const s: Record<string, Statement> = {
    get: db.prepare(`SELECT provider, number FROM task_review_targets WHERE task_id = ?`),
    put: db.prepare(
      `INSERT INTO task_review_targets (task_id, provider, number, set_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          provider = excluded.provider, number = excluded.number, set_at = excluded.set_at`,
    ),
    clear: db.prepare(`DELETE FROM task_review_targets WHERE task_id = ?`),
  };
  return {
    get(taskId) {
      const row = s.get!.get(taskId) as { provider: string; number: number } | undefined;
      if (!row) return null;
      return { provider: row.provider === 'ado' ? 'ado' : 'github', number: row.number };
    },
    set(taskId, target) {
      if (!target) s.clear!.run(taskId);
      else s.put!.run(taskId, target.provider, target.number, new Date().toISOString());
    },
  };
}

let repo: TaskReviewTargetsRepo | null = null;

/** The app's repo over its database. */
export function taskReviewTargetsRepo(): TaskReviewTargetsRepo {
  if (repo) return repo;
  const db = getRawDb();
  if (!db) throw new Error('db unavailable');
  repo = createTaskReviewTargetsRepo(db);
  return repo;
}
