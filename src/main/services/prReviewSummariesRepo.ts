import type { Database, Statement } from 'better-sqlite3';
import { getRawDb } from '../db/client';
import type { PrProvider, PrReviewSummary } from '@shared/types';

/** A task's draft summary for a PR: the review's PR-level comment, which
 *  Submit posts and clears. */
export interface PrReviewSummariesRepo {
  getSummary(taskId: string, provider: PrProvider, number: number): PrReviewSummary | null;
  /** An empty body clears it. */
  setSummary(taskId: string, provider: PrProvider, number: number, summary: PrReviewSummary): void;
}

/** The one owner of `pr_review_summaries` SQL. */
export function createPrReviewSummariesRepo(db: Database): PrReviewSummariesRepo {
  const s: Record<string, Statement> = {
    get: db.prepare(
      `SELECT body, author FROM pr_review_summaries WHERE task_id = ? AND provider = ? AND number = ?`,
    ),
    put: db.prepare(
      `INSERT INTO pr_review_summaries (task_id, provider, number, body, author, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id, provider, number) DO UPDATE SET
          body = excluded.body, author = excluded.author, updated_at = excluded.updated_at`,
    ),
    clear: db.prepare(
      `DELETE FROM pr_review_summaries WHERE task_id = ? AND provider = ? AND number = ?`,
    ),
  };
  return {
    getSummary(taskId, provider, number) {
      const row = s.get!.get(taskId, provider, number) as
        | { body: string; author: string }
        | undefined;
      return row ? { body: row.body, author: row.author === 'agent' ? 'agent' : 'user' } : null;
    },
    setSummary(taskId, provider, number, { body, author }) {
      if (!body.trim()) s.clear!.run(taskId, provider, number);
      else s.put!.run(taskId, provider, number, body, author, new Date().toISOString());
    },
  };
}

let repo: PrReviewSummariesRepo | null = null;

/** The app's repo over its database. */
export function prReviewSummariesRepo(): PrReviewSummariesRepo {
  if (repo) return repo;
  const db = getRawDb();
  if (!db) throw new Error('db unavailable');
  repo = createPrReviewSummariesRepo(db);
  return repo;
}
