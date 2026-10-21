import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { DiffCommentInput } from '../../../shared/types';

let db: Database.Database;
vi.mock('../../db/client', () => ({ getRawDb: () => db }));

import { runMigrations } from '../../db/migrate';
import { computeOrphans, createDiffCommentsRepo, type DiffCommentsRepo } from '../diffCommentsRepo';

describe('computeOrphans', () => {
  const row = (id: string, file_path: string, view_scope = 'live') => ({
    id,
    file_path,
    view_scope,
  });

  it('returns ids of comments whose path is not in the existing set', () => {
    const rows = [row('a', 'src/foo.ts'), row('b', 'src/bar.ts'), row('c', 'src/missing.ts')];
    expect(computeOrphans(rows, new Set(['src/foo.ts', 'src/bar.ts']))).toEqual(['c']);
  });

  it('returns every id when the existing set is empty', () => {
    expect(computeOrphans([row('a', 'x'), row('b', 'y')], new Set())).toEqual(['a', 'b']);
  });

  it("keeps PR drafts, whose files needn't exist in the checkout", () => {
    const rows = [row('a', 'gone.ts', 'pr:github:4'), row('b', 'gone.ts', 'commit:abc')];
    expect(computeOrphans(rows, new Set())).toEqual(['b']);
  });
});

describe('diffCommentsRepo', () => {
  let repo: DiffCommentsRepo;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations();
    db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/repo')`).run();
    db.prepare(
      `INSERT INTO tasks (id, project_id, name, branch, path) VALUES ('t1', 'p1', 't', 'b', '/repo')`,
    ).run();
    repo = createDiffCommentsRepo(db);
  });

  const input = (over: Partial<DiffCommentInput> = {}): DiffCommentInput => ({
    id: 'c1',
    taskId: 't1',
    filePath: 'src/a.ts',
    startLine: 3,
    endLine: 5,
    text: 'hm',
    sent: false,
    viewScope: 'pr:github:4',
    ...over,
  });

  it('round-trips side, replyTo and author', () => {
    expect(repo.upsertFromUser(input({ replyTo: 'T9' }))).toMatchObject({
      side: 'RIGHT',
      replyTo: 'T9',
      author: 'user',
      sent: false,
    });
  });

  it("keeps an agent's draft the agent's until its text changes", () => {
    repo.upsertFromAgent({
      id: 'c1',
      taskId: 't1',
      filePath: 'src/a.ts',
      startLine: 3,
      endLine: 5,
      text: 'agent says',
      viewScope: 'pr:github:4',
      replyTo: null,
      kind: 'comment',
    });
    // A range snapshot from the editor: same text.
    expect(repo.upsertFromUser(input({ text: 'agent says', startLine: 4 })).author).toBe('agent');
    // The user rewrites it.
    expect(repo.upsertFromUser(input({ text: 'mine now' })).author).toBe('user');
  });

  it("lists a PR's comments, not its notes, split into line comments and replies", () => {
    repo.upsertFromUser(input({ id: 'line', kind: 'comment' }));
    repo.upsertFromUser(input({ id: 'reply', replyTo: 'T1', kind: 'comment' }));
    repo.upsertFromUser(input({ id: 'note' }));
    repo.upsertFromUser(input({ id: 'other-pr', viewScope: 'pr:github:5', kind: 'comment' }));
    repo.upsertFromUser(input({ id: 'live', viewScope: 'live' }));
    const { comments, replies } = repo.listPrDrafts('t1', 'github', 4);
    expect(comments.map((c) => c.id)).toEqual(['line']);
    expect(replies.map((c) => c.id)).toEqual(['reply']);
  });

  it('writes a note unless told otherwise, and a comment only on a PR', () => {
    expect(repo.upsertFromUser(input()).kind).toBe('note');
    expect(repo.upsertFromUser(input({ id: 'c2', kind: 'comment' })).kind).toBe('comment');
    expect(repo.upsertFromUser(input({ id: 'c3', kind: 'comment', viewScope: 'live' })).kind).toBe(
      'note',
    );
  });

  it('promotes a note to a comment, and keeps the kind when a write leaves it out', () => {
    repo.upsertFromUser(input());
    expect(repo.upsertFromUser(input({ kind: 'comment' })).kind).toBe('comment');
    expect(repo.upsertFromUser(input({ startLine: 4 })).kind).toBe('comment');
  });

  it("makes the user's draft the agent's when the agent rewrites it, not when it moves it", () => {
    repo.upsertFromUser(input());
    const agentEdit = {
      id: 'c1',
      taskId: 't1',
      filePath: 'src/a.ts',
      startLine: 3,
      endLine: 5,
      text: 'hm',
      viewScope: 'pr:github:4',
      replyTo: null,
      kind: 'note' as const,
    };
    expect(repo.upsertFromAgent({ ...agentEdit, startLine: 4 }).author).toBe('user');
    expect(repo.upsertFromAgent({ ...agentEdit, text: 'better' }).author).toBe('agent');
  });

  it("writes an agent's note or comment", () => {
    const draft = {
      id: 'a1',
      taskId: 't1',
      filePath: 'src/a.ts',
      startLine: 1,
      endLine: 1,
      text: 'x',
      viewScope: 'pr:ado:9',
      replyTo: null,
    };
    expect(repo.upsertFromAgent({ ...draft, kind: 'note' }).kind).toBe('note');
    expect(repo.upsertFromAgent({ ...draft, kind: 'comment' }).kind).toBe('comment');
  });

  it('deletes by ids, and prunes only non-PR comments on missing files', () => {
    repo.upsertFromUser(input({ id: 'a', viewScope: 'live', filePath: 'gone.ts' }));
    repo.upsertFromUser(input({ id: 'b', filePath: 'gone.ts' }));
    repo.upsertFromUser(input({ id: 'c' }));
    expect(repo.prune('t1', new Set(['src/a.ts']))).toBe(1);
    repo.deleteByIds(['c']);
    expect(repo.listByTask('t1').map((c) => c.id)).toEqual(['b']);
  });
});

describe('migration to notes and comments', () => {
  it('makes the PR drafts written before it comments, and everything else notes', () => {
    db = new Database(':memory:');
    runMigrations();
    db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/repo')`).run();
    db.prepare(
      `INSERT INTO tasks (id, project_id, name, branch, path) VALUES ('t1', 'p1', 't', 'b', '/repo')`,
    ).run();
    // Back to before the column: drop it, add rows, migrate again.
    db.exec(`ALTER TABLE diff_editor_comments DROP COLUMN kind`);
    const insert = db.prepare(
      `INSERT INTO diff_editor_comments (id, task_id, file_path, start_line, end_line, text, view_scope)
       VALUES (?, 't1', 'a.ts', 1, 1, 'x', ?)`,
    );
    insert.run('pr', 'pr:github:4');
    insert.run('live', 'live');
    runMigrations();
    const kinds = createDiffCommentsRepo(db)
      .listByTask('t1')
      .map((c) => [c.id, c.kind]);
    expect(Object.fromEntries(kinds)).toEqual({ live: 'note', pr: 'comment' });
  });
});
