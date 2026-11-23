import type { Database, Statement } from 'better-sqlite3';
import { getRawDb } from '../db/client';
import type { PrProvider, PrReviewSummary } from '@shared/types';

/** A task's review of a PR, beyond its line comments. Which PRs it's reviewing:
 *  Review starts one, Submit ends it, and while it lasts what the person writes
 *  in the PR's view is a comment, not a note. And its draft summary, the
 *  review's PR-level comment, which Submit posts and clears. */
export interface PrReviewsInProgressRepo {
  isInReview(taskId: string, provider: PrProvider, number: number): boolean;
  setInReview(taskId: string, provider: PrProvider, number: number, on: boolean): void;
  getSummary(taskId: string, provider: PrProvider, number: number): PrReviewSummary | null;
  /** An empty body clears it. With `ifUnchangedSince` (an updatedAt, or '' for
   *  "there is none"), throws a SummaryConflictError unless it's still that one. */
  setSummary(
    taskId: string,
    provider: PrProvider,
    number: number,
    summary: PrReviewSummary,
    ifUnchangedSince?: string,
  ): void;
}

/** A conditional summary write found it changed since the version it named. */
export class SummaryConflictError extends Error {
  constructor(readonly current: PrReviewSummary | null) {
    super('the summary changed since it was read');
    this.name = 'SummaryConflictError';
  }
}

/** The one owner of `pr_reviews_in_progress` and `pr_review_summaries` SQL. */
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
    getSummary: db.prepare(
      `SELECT body, author, updated_at FROM pr_review_summaries WHERE task_id = ? AND provider = ? AND number = ?`,
    ),
    putSummary: db.prepare(
      `INSERT INTO pr_review_summaries (task_id, provider, number, body, author, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id, provider, number) DO UPDATE SET
          body = excluded.body, author = excluded.author, updated_at = excluded.updated_at`,
    ),
    clearSummary: db.prepare(
      `DELETE FROM pr_review_summaries WHERE task_id = ? AND provider = ? AND number = ?`,
    ),
  };
  const getSummary = (taskId: string, provider: PrProvider, number: number) => {
    const row = s.getSummary!.get(taskId, provider, number) as
      | { body: string; author: string; updated_at: string }
      | undefined;
    return row
      ? {
          body: row.body,
          author: row.author === 'agent' ? ('agent' as const) : ('user' as const),
          updatedAt: row.updated_at,
        }
      : null;
  };
  return {
    isInReview: (taskId, provider, number) => !!s.get!.get(taskId, provider, number),
    setInReview(taskId, provider, number, on) {
      (on ? s.start! : s.end!).run(taskId, provider, number);
    },
    getSummary,
    setSummary(taskId, provider, number, { body, author }, ifUnchangedSince) {
      const current = getSummary(taskId, provider, number);
      if (ifUnchangedSince !== undefined && (current?.updatedAt ?? '') !== ifUnchangedSince) {
        throw new SummaryConflictError(current);
      }
      if (!body.trim()) {
        s.clearSummary!.run(taskId, provider, number);
        return;
      }
      // updatedAt is the summary's version: a write always moves it on.
      const last = Date.parse(current?.updatedAt ?? '');
      const now = Number.isNaN(last) ? Date.now() : Math.max(Date.now(), last + 1);
      s.putSummary!.run(taskId, provider, number, body, author, new Date(now).toISOString());
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
