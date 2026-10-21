import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let db: Database.Database;
vi.mock('../../db/client', () => ({ getRawDb: () => db }));

import { runMigrations } from '../../db/migrate';
import { createPrReviewsInProgressRepo } from '../prReviewsInProgressRepo';

describe('prReviewsInProgressRepo', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations();
    db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/repo')`).run();
    db.prepare(
      `INSERT INTO tasks (id, project_id, name, branch, path) VALUES ('t1', 'p1', 't', 'b', '/repo')`,
    ).run();
  });

  it('remembers a review per task and PR until it ends', () => {
    const repo = createPrReviewsInProgressRepo(db);
    expect(repo.isInReview('t1', 'github', 4)).toBe(false);
    repo.setInReview('t1', 'github', 4, true);
    repo.setInReview('t1', 'github', 4, true);
    expect(repo.isInReview('t1', 'github', 4)).toBe(true);
    expect(repo.isInReview('t1', 'ado', 4)).toBe(false);
    expect(repo.isInReview('t1', 'github', 5)).toBe(false);
    repo.setInReview('t1', 'github', 4, false);
    expect(repo.isInReview('t1', 'github', 4)).toBe(false);
  });

  it('keeps a draft summary per task and PR, and clears it when emptied', () => {
    const repo = createPrReviewsInProgressRepo(db);
    expect(repo.getSummary('t1', 'ado', 7)).toBeNull();
    repo.setSummary('t1', 'ado', 7, { body: 'Looks good', author: 'agent' });
    expect(repo.getSummary('t1', 'ado', 7)).toEqual({ body: 'Looks good', author: 'agent' });
    repo.setSummary('t1', 'ado', 7, { body: 'Mine now', author: 'user' });
    expect(repo.getSummary('t1', 'ado', 7)).toEqual({ body: 'Mine now', author: 'user' });
    expect(repo.getSummary('t1', 'ado', 8)).toBeNull();
    repo.setSummary('t1', 'ado', 7, { body: '  ', author: 'user' });
    expect(repo.getSummary('t1', 'ado', 7)).toBeNull();
  });
});
