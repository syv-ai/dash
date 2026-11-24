import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let db: Database.Database;
vi.mock('../../db/client', () => ({ getRawDb: () => db }));

import { runMigrations } from '../../db/migrate';
import { createTaskReviewTargetsRepo } from '../taskReviewTargetsRepo';

describe('taskReviewTargetsRepo', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations();
    db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/repo')`).run();
    for (const id of ['t1', 't2'])
      db.prepare(
        `INSERT INTO tasks (id, project_id, name, branch, path) VALUES (?, 'p1', 't', 'b', '/repo')`,
      ).run(id);
  });

  it('keeps one target per task, replaced by the next pick and cleared by null', () => {
    const repo = createTaskReviewTargetsRepo(db);
    expect(repo.get('t1')).toBeNull();
    repo.set('t1', { provider: 'github', number: 4 });
    repo.set('t2', { provider: 'ado', number: 7 });
    expect(repo.get('t1')).toEqual({ provider: 'github', number: 4 });
    repo.set('t1', { provider: 'github', number: 5 });
    expect(repo.get('t1')).toEqual({ provider: 'github', number: 5 });
    repo.set('t1', null);
    expect(repo.get('t1')).toBeNull();
    expect(repo.get('t2')).toEqual({ provider: 'ado', number: 7 });
  });

  it('goes with its task', () => {
    const repo = createTaskReviewTargetsRepo(db);
    repo.set('t1', { provider: 'github', number: 4 });
    db.prepare(`DELETE FROM tasks WHERE id = 't1'`).run();
    expect(repo.get('t1')).toBeNull();
  });
});
