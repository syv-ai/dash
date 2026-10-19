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
    });
    // A range snapshot from the editor: same text.
    expect(repo.upsertFromUser(input({ text: 'agent says', startLine: 4 })).author).toBe('agent');
    // The user rewrites it.
    expect(repo.upsertFromUser(input({ text: 'mine now' })).author).toBe('user');
  });

  it("lists a PR's drafts split into line comments and replies", () => {
    repo.upsertFromUser(input({ id: 'line' }));
    repo.upsertFromUser(input({ id: 'reply', replyTo: 'T1' }));
    repo.upsertFromUser(input({ id: 'other-pr', viewScope: 'pr:github:5' }));
    repo.upsertFromUser(input({ id: 'live', viewScope: 'live' }));
    const { comments, replies } = repo.listPrDrafts('t1', 'github', 4);
    expect(comments.map((c) => c.id)).toEqual(['line']);
    expect(replies.map((c) => c.id)).toEqual(['reply']);
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
