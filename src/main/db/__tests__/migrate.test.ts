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
