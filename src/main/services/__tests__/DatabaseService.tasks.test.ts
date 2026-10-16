import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';

let raw: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
vi.mock('../../db/client', () => ({ getDb: () => db, getRawDb: () => raw, initDb: () => db }));

import { runMigrations } from '../../db/migrate';
import { DatabaseService } from '../DatabaseService';

beforeEach(() => {
  raw = new Database(':memory:');
  db = drizzle(raw, { schema });
  runMigrations();
  raw.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/repo')`).run();
});

const base = { projectId: 'p1', branch: 'b', path: '/repo/wt' };

describe('DatabaseService tasks: Dash access and parent task', () => {
  it('defaults to no Dash access and no parent', () => {
    const t = DatabaseService.saveTask({ ...base, name: 'a' });
    expect(t.dashAccess).toBe(false);
    expect(t.parentTaskId).toBeNull();
  });

  it('writes both on insert and never changes them on update', () => {
    const parent = DatabaseService.saveTask({ ...base, name: 'parent', path: '/repo/p' });
    const t = DatabaseService.saveTask({
      ...base,
      name: 'child',
      dashAccess: true,
      parentTaskId: parent.id,
    });
    expect(t.dashAccess).toBe(true);
    expect(t.parentTaskId).toBe(parent.id);

    const renamed = DatabaseService.saveTask({
      ...base,
      id: t.id,
      name: 'renamed',
      dashAccess: false,
      parentTaskId: null,
    });
    expect(renamed.name).toBe('renamed');
    expect(renamed.dashAccess).toBe(true);
    expect(renamed.parentTaskId).toBe(parent.id);
  });

  it('setTaskDashAccess flips the flag alone', () => {
    const t = DatabaseService.saveTask({ ...base, name: 'a', contextPrompt: 'ctx' });
    DatabaseService.setTaskDashAccess(t.id, true);
    expect(DatabaseService.getTask(t.id)).toMatchObject({ dashAccess: true, contextPrompt: 'ctx' });
    DatabaseService.setTaskDashAccess(t.id, false);
    expect(DatabaseService.getTask(t.id)?.dashAccess).toBe(false);
  });

  it('getTaskChildren returns non-archived children only', () => {
    const parent = DatabaseService.saveTask({ ...base, name: 'parent', path: '/repo/p' });
    const live = DatabaseService.saveTask({ ...base, name: 'live', parentTaskId: parent.id });
    const gone = DatabaseService.saveTask({ ...base, name: 'gone', parentTaskId: parent.id });
    DatabaseService.saveTask({ ...base, name: 'other' });
    DatabaseService.archiveTask(gone.id);

    expect(DatabaseService.getTaskChildren(parent.id).map((t) => t.id)).toEqual([live.id]);
  });
});
