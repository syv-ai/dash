import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let db: Database.Database;
vi.mock('../../db/client', () => ({ getRawDb: () => db }));

import { runMigrations } from '../../db/migrate';
import { createPrViewedFilesRepo } from '../prViewedFilesRepo';

const pr = { provider: 'github', number: 4 } as const;

describe('prViewedFilesRepo', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations();
    db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/repo')`).run();
    db.prepare(
      `INSERT INTO tasks (id, project_id, name, branch, path) VALUES ('t1', 'p1', 't', 'b', '/repo')`,
    ).run();
  });

  it('keeps the blob each file was viewed at, per task and PR, until unmarked', () => {
    const repo = createPrViewedFilesRepo(db);
    expect(repo.list('t1', pr)).toEqual({});
    repo.set('t1', pr, 'src/a.ts', 'blob1');
    repo.set('t1', pr, 'src/b.ts', 'blob2');
    repo.set('t1', { provider: 'ado', number: 4 }, 'src/a.ts', 'other');
    repo.set('t1', pr, 'src/a.ts', 'blob3');
    expect(repo.list('t1', pr)).toEqual({ 'src/a.ts': 'blob3', 'src/b.ts': 'blob2' });
    repo.set('t1', pr, 'src/b.ts', null);
    expect(repo.list('t1', pr)).toEqual({ 'src/a.ts': 'blob3' });
    expect(repo.list('t1', { provider: 'ado', number: 4 })).toEqual({ 'src/a.ts': 'other' });
  });

  it('goes with its task', () => {
    const repo = createPrViewedFilesRepo(db);
    repo.set('t1', pr, 'src/a.ts', 'blob1');
    db.prepare(`DELETE FROM tasks WHERE id = 't1'`).run();
    expect(repo.list('t1', pr)).toEqual({});
  });
});
