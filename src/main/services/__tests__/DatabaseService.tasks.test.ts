import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';

let raw: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
vi.mock('../../db/client', () => ({ getDb: () => db, getRawDb: () => raw, initDb: () => db }));

import { runMigrations } from '../../db/migrate';
import { DatabaseService } from '../DatabaseService';
import { FolderOccupiedError } from '../FolderOccupiedError';

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

  it('setTaskFavorite flips the flag alone, without bumping updatedAt; a save keeps it', () => {
    const t = DatabaseService.saveTask({ ...base, name: 'a', contextPrompt: 'ctx' });
    expect(t.favorite).toBe(false);
    DatabaseService.setTaskFavorite(t.id, true);
    expect(DatabaseService.getTask(t.id)).toMatchObject({
      favorite: true,
      contextPrompt: 'ctx',
      updatedAt: t.updatedAt,
    });
    const renamed = DatabaseService.saveTask({ ...base, id: t.id, name: 'renamed' });
    expect(renamed.favorite).toBe(true);
    DatabaseService.setTaskFavorite(t.id, false);
    expect(DatabaseService.getTask(t.id)?.favorite).toBe(false);
  });
});

describe('DatabaseService tasks: the folder rule', () => {
  const inPlace = { projectId: 'p1', path: '/repo', useWorktree: false };

  it('lets branchless tasks share a plain folder', () => {
    DatabaseService.saveTask({ ...inPlace, name: 'a', branch: '' });
    const b = DatabaseService.saveTask({ ...inPlace, name: 'b', branch: '' });
    expect(DatabaseService.findFolderOccupant('p1', '/repo', '')).toBeNull();
    DatabaseService.archiveTask(b.id);
    expect(() => DatabaseService.restoreTask(b.id)).not.toThrow();
    expect(DatabaseService.getTasksByPath('/repo')).toHaveLength(2);
  });

  it('gives a task on a branch the folder to itself, either way round', () => {
    const plain = DatabaseService.saveTask({ ...inPlace, name: 'plain', branch: '' });
    expect(() => DatabaseService.saveTask({ ...inPlace, name: 'co', branch: 'main' })).toThrow(
      FolderOccupiedError,
    );
    DatabaseService.archiveTask(plain.id);
    const co = DatabaseService.saveTask({ ...inPlace, name: 'co', branch: 'main' });
    expect(DatabaseService.findFolderOccupant('p1', '/repo', '')).toEqual({
      id: co.id,
      name: 'co',
    });
    expect(() => DatabaseService.restoreTask(plain.id)).toThrow(/"co"/);
  });

  it('lets a task be saved again beside the tasks it shares its folder with', () => {
    const a = DatabaseService.saveTask({ ...inPlace, name: 'a', branch: '' });
    DatabaseService.saveTask({ ...inPlace, name: 'b', branch: '' });
    expect(DatabaseService.saveTask({ ...inPlace, id: a.id, name: 'a2', branch: '' }).name).toBe(
      'a2',
    );
  });
});

describe('DatabaseService tasks: sessions', () => {
  const inPlace = { projectId: 'p1', path: '/repo', useWorktree: false, branch: '' };

  it("keeps every session a task ran, its current one and the hooks', once each", () => {
    const a = DatabaseService.saveTask({ ...inPlace, name: 'a' });
    DatabaseService.setTaskSession(a.id, { jobId: 'j1', sessionId: 's1' });
    DatabaseService.noteTaskSession(a.id, 's2');
    DatabaseService.noteTaskSession(a.id, 's2');
    DatabaseService.setTaskSession(a.id, { jobId: null, sessionId: null });
    expect(DatabaseService.getTaskSessionIds(a.id).sort()).toEqual(['s1', 's2']);
  });

  it('tells a folder other tasks share, archived ones included, from a task of its own', () => {
    const a = DatabaseService.saveTask({ ...inPlace, name: 'a' });
    const wt = DatabaseService.saveTask({ ...base, name: 'wt' });
    expect(DatabaseService.sharesTranscriptDir(a)).toBe(false);
    const b = DatabaseService.saveTask({ ...inPlace, name: 'b' });
    DatabaseService.archiveTask(b.id);
    expect(DatabaseService.sharesTranscriptDir(a)).toBe(true);
    expect(DatabaseService.sharesTranscriptDir(wt)).toBe(false);
  });
});
