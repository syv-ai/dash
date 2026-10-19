import type { Database, Statement } from 'better-sqlite3';
import { getRawDb } from '../db/client';
import type { PrProvider } from '@shared/types';

/** Which PRs a task is reviewing: Review starts one, Submit ends it. While it
 *  lasts, what the person writes in the PR's view is a comment, not a note. */
export interface PrReviewsInProgressRepo {
  isInReview(taskId: string, provider: PrProvider, number: number): boolean;
  setInReview(taskId: string, provider: PrProvider, number: number, on: boolean): void;
}

/** The one owner of `pr_reviews_in_progress` SQL. */
export function createPrReviewsInProgressRepo(db: Database): PrReviewsInProgressRepo {
  const s: Record<string, Statement> = {
    get: db.prepare(
      `SELECT 1 FROM pr_reviews_in_progress WHERE task_id = ? AND provider = ? AND number = ?`,
    ),
    start: db.prepare(
      `INSERT OR IGNORE INTO pr_reviews_in_progress (task_id, provider, number) VALUES (?, ?, ?)`,
    ),
    end: db.prepare(
      `DELETE FROM pr_reviews_in_progress WHERE task_id = ? AND provider = ? AND number = ?`,
    ),
  };
  return {
    isInReview: (taskId, provider, number) => !!s.get!.get(taskId, provider, number),
    setInReview(taskId, provider, number, on) {
      (on ? s.start! : s.end!).run(taskId, provider, number);
    },
  };
}

let repo: PrReviewsInProgressRepo | null = null;

/** The app's repo over its database. */
export function prReviewsInProgressRepo(): PrReviewsInProgressRepo {
  if (repo) return repo;
  const db = getRawDb();
  if (!db) throw new Error('db unavailable');
  repo = createPrReviewsInProgressRepo(db);
  return repo;
}
