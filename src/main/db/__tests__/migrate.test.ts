import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let db: Database.Database;
vi.mock('../client', () => ({ getRawDb: () => db }));

import { runMigrations } from '../migrate';

beforeEach(() => {
  db = new Database(':memory:');
});

function insertTask(id: string, totalTokens: number) {
  db.prepare(
    `INSERT INTO tasks (id, project_id, name, branch, path, total_tokens, tokens_backfilled_at)
     VALUES (?, 'p1', ?, 'b', ?, ?, '2026-01-01T00:00:00Z')`,
  ).run(id, id, `/repo/.claude/worktrees/${id}`, totalTokens);
}

const backfilledAt = (id: string) =>
  (db.prepare(`SELECT tokens_backfilled_at AS t FROM tasks WHERE id = ?`).get(id) as { t: string })
    .t;

describe('runMigrations: token re-backfill after the path-encoding fix', () => {
  it('re-queues zero-token tasks once and leaves real totals alone', () => {
    runMigrations();
    db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/repo')`).run();
    insertTask('empty', 0);
    insertTask('counted', 1234);
    db.pragma('user_version = 0'); // as an install from before 0.16.15

    runMigrations();
    expect(backfilledAt('empty')).toBeNull();
    expect(backfilledAt('counted')).not.toBeNull();

    db.prepare(`UPDATE tasks SET tokens_backfilled_at = 'later' WHERE id = 'empty'`).run();
    runMigrations();
    expect(backfilledAt('empty')).toBe('later');
  });
});

describe('runMigrations: Dash access and parent task columns', () => {
  type Col = { name: string; type: string; notnull: number; dflt_value: string | null };
  const column = (name: string) =>
    (db.prepare(`PRAGMA table_info(tasks)`).all() as Col[]).find((c) => c.name === name);

  it('adds dash_access (NOT NULL DEFAULT 0) and parent_task_id, idempotently', () => {
    runMigrations();
    expect(() => runMigrations()).not.toThrow();

    expect(column('dash_access')).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
    expect(column('parent_task_id')).toMatchObject({ type: 'TEXT', notnull: 0 });
  });
});

describe('runMigrations: favourite tasks', () => {
  type Col = { name: string; type: string; notnull: number; dflt_value: string | null };
  const column = (name: string) =>
    (db.prepare(`PRAGMA table_info(tasks)`).all() as Col[]).find((c) => c.name === name);

  it('adds favorite (NOT NULL DEFAULT 0) to existing rows, idempotently, keeping the rest', () => {
    // An install from before the column, with a task in it.
    runMigrations();
    db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/repo')`).run();
    db.prepare(
      `INSERT INTO tasks (id, project_id, name, branch, path) VALUES ('t1', 'p1', 'old', 'b', '/w')`,
    ).run();
    db.exec(`ALTER TABLE tasks DROP COLUMN favorite`);

    runMigrations();
    expect(() => runMigrations()).not.toThrow();

    expect(column('favorite')).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
    expect(db.prepare(`SELECT name, favorite FROM tasks WHERE id = 't1'`).get()).toEqual({
      name: 'old',
      favorite: 0,
    });
  });
});

describe('runMigrations: PR review draft columns on diff comments', () => {
  type Col = { name: string; type: string; notnull: number; dflt_value: string | null };
  const column = (name: string) =>
    (db.prepare(`PRAGMA table_info(diff_editor_comments)`).all() as Col[]).find(
      (c) => c.name === name,
    );

  it('adds side, reply_to and author, idempotently', () => {
    runMigrations();
    expect(() => runMigrations()).not.toThrow();
    expect(column('side')).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "'RIGHT'" });
    expect(column('reply_to')).toMatchObject({ type: 'TEXT', notnull: 0 });
    expect(column('author')).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "'user'" });
  });
});

describe('runMigrations: memory_seen_at on projects', () => {
  const seenAt = (id: string) =>
    (
      db.prepare(`SELECT memory_seen_at AS t FROM projects WHERE id = ?`).get(id) as {
        t: number | null;
      }
    ).t;

  it('adds the column, marks existing projects seen now, and leaves it alone on later runs', () => {
    runMigrations();
    db.exec(`ALTER TABLE projects DROP COLUMN memory_seen_at`); // as a DB from before the badge
    db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/repo')`).run();

    const before = Date.now();
    runMigrations();
    expect(seenAt('p1')).toBeGreaterThanOrEqual(before);

    db.prepare(`UPDATE projects SET memory_seen_at = 5 WHERE id = 'p1'`).run();
    expect(() => runMigrations()).not.toThrow();
    expect(seenAt('p1')).toBe(5);
  });
});

describe('runMigrations: worktree script columns', () => {
  const columns = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

  it('drops them from a DB that has them, keeps the rows, and runs again cleanly', () => {
    runMigrations();
    // As a DB from before the scripts went.
    db.exec(`ALTER TABLE projects ADD COLUMN worktree_setup_script TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN setup_script TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN teardown_script TEXT`);
    db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/repo')`).run();
    insertTask('t1', 0);
    db.prepare(`UPDATE tasks SET setup_script = 'pnpm install' WHERE id = 't1'`).run();

    runMigrations();
    expect(columns('projects')).not.toContain('worktree_setup_script');
    expect(columns('tasks')).not.toContain('setup_script');
    expect(columns('tasks')).not.toContain('teardown_script');
    expect(db.prepare(`SELECT id FROM tasks`).all()).toEqual([{ id: 't1' }]);

    expect(() => runMigrations()).not.toThrow();
  });
});
