import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { DiffComment } from '../../../../shared/types';
import { ControlError, createRegistry, type Registry } from '../../registry';
import { fakeLookups, makeProject, makeTask } from '../../__tests__/fixtures';
import { registerReviewCapabilities } from '../review';

let db: Database.Database;
vi.mock('../../../db/client', () => ({ getRawDb: () => db }));

import { runMigrations } from '../../../db/migrate';
import { createDiffCommentsRepo, type DiffCommentsRepo } from '../../../services/diffCommentsRepo';
import { createPrReviewsInProgressRepo } from '../../../services/prReviewsInProgressRepo';
import { createTaskReviews } from '../../../services/prReview/taskReview';

const asTask = (taskId: string) => ({ kind: 'task', taskId }) as const;

const tasks = [
  makeTask({ id: 'me', projectId: 'pA', dashAccess: true }),
  makeTask({ id: 'child', projectId: 'pA', parentTaskId: 'me' }),
  makeTask({ id: 'sibling', projectId: 'pA' }),
];

let registry: Registry;
let comments: DiffCommentsRepo;
let changed: string[];

const row = (over: Partial<DiffComment> & { id: string }): DiffComment => ({
  taskId: 'me',
  filePath: 'src/a.ts',
  startLine: 3,
  endLine: 3,
  text: 'x',
  sent: false,
  viewScope: 'pr:github:12',
  side: 'RIGHT',
  replyTo: null,
  author: 'agent',
  kind: 'comment',
  createdAt: '',
  updatedAt: '',
  ...over,
});

/** A stored draft, written as it is (author and all). */
function put(c: DiffComment) {
  db.prepare(
    `INSERT INTO diff_editor_comments (id, task_id, file_path, start_line, end_line, text, sent,
       view_scope, side, reply_to, author, kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '')`,
  ).run(
    c.id,
    c.taskId,
    c.filePath,
    c.startLine,
    c.endLine,
    c.text,
    c.sent ? 1 : 0,
    c.viewScope,
    c.side,
    c.replyTo,
    c.author,
    c.kind,
  );
}

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations();
  db.prepare(`INSERT INTO projects (id, name, path) VALUES ('pA', 'p', '/repo')`).run();
  for (const t of tasks) {
    db.prepare(
      `INSERT INTO tasks (id, project_id, name, branch, path) VALUES (?, 'pA', ?, 'b', '/repo')`,
    ).run(t.id, t.id);
  }
  comments = createDiffCommentsRepo(db);
  changed = [];
  registry = createRegistry(fakeLookups([makeProject({ id: 'pA' })], tasks));
  registerReviewCapabilities(registry, {
    providerFor: () => 'github',
    getTask: (id) => tasks.find((t) => t.id === id),
    reviews: createTaskReviews({
      comments,
      reviews: createPrReviewsInProgressRepo(db),
      changed: (taskId) => void changed.push(taskId),
    }),
  });
});

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    if (err instanceof ControlError) return err.status;
    throw err;
  }
}

describe('review.drafts_create', () => {
  it("drafts into the calling task's PR view, as the agent", async () => {
    const created = (await registry.call(asTask('me'), 'review.drafts_create', {
      number: 12,
      path: '/src/a.ts',
      startLine: 4,
      endLine: 6,
      body: 'Null here?',
      kind: 'comment',
    })) as { id: string };
    expect(comments.get(created.id)).toMatchObject({
      taskId: 'me',
      filePath: 'src/a.ts',
      startLine: 4,
      endLine: 6,
      text: 'Null here?',
      viewScope: 'pr:github:12',
      author: 'agent',
      replyTo: null,
      kind: 'comment',
    });
    expect(changed).toEqual(['me']);
  });

  it('writes a note for the developer, and refuses a write without a kind', async () => {
    const input = { number: 12, path: 'a.ts', startLine: 1, body: 'watch this' };
    const note = (await registry.call(asTask('me'), 'review.drafts_create', {
      ...input,
      kind: 'note',
    })) as { id: string; kind: string };
    expect(comments.get(note.id)!.kind).toBe('note');
    expect(await status(registry.call(asTask('me'), 'review.drafts_create', input))).toBe(400);
  });

  it('reaches a child task, not a sibling', async () => {
    const input = { number: 12, path: 'a.ts', startLine: 1, body: 'b', kind: 'note' };
    expect(
      await status(
        registry.call(asTask('me'), 'review.drafts_create', { ...input, taskId: 'child' }),
      ),
    ).toBe(200);
    expect(
      await status(
        registry.call(asTask('me'), 'review.drafts_create', { ...input, taskId: 'sibling' }),
      ),
    ).toBe(404);
  });

  it('refuses a range that ends before it starts, and the wrong provider', async () => {
    const input = { number: 12, path: 'a.ts', startLine: 5, body: 'b', kind: 'comment' };
    expect(
      await status(registry.call(asTask('me'), 'review.drafts_create', { ...input, endLine: 4 })),
    ).toBe(400);
    expect(
      await status(
        registry.call(asTask('me'), 'review.drafts_create', { ...input, provider: 'ado' }),
      ),
    ).toBe(400);
  });
});

describe('review.drafts_update / drafts_delete', () => {
  it("changes the agent's own draft", async () => {
    put(row({ id: 'd1' }));
    await registry.call(asTask('me'), 'review.drafts_update', {
      id: 'd1',
      body: 'better',
      endLine: 8,
    });
    expect(comments.get('d1')).toMatchObject({ text: 'better', startLine: 3, endLine: 8 });
    await registry.call(asTask('me'), 'review.drafts_update', { id: 'd1', kind: 'note' });
    expect(comments.get('d1')).toMatchObject({ text: 'better', kind: 'note' });
    await registry.call(asTask('me'), 'review.drafts_delete', { id: 'd1' });
    expect(!!comments.get('d1')).toBe(false);
    expect(changed).toEqual(['me', 'me', 'me']);
  });

  it("changes and deletes the user's drafts too", async () => {
    put(row({ id: 'u1', author: 'user' }));
    await registry.call(asTask('me'), 'review.drafts_update', { id: 'u1', body: 'reworded' });
    expect(comments.get('u1')!.text).toBe('reworded');
    await registry.call(asTask('me'), 'review.drafts_delete', { id: 'u1' });
    expect(!!comments.get('u1')).toBe(false);
  });

  it("can't see another task's draft, or a non-PR comment", async () => {
    put(row({ id: 's1', taskId: 'sibling' }));
    put(row({ id: 'l1', viewScope: 'live' }));
    expect(
      await status(registry.call(asTask('me'), 'review.drafts_update', { id: 's1', body: 'x' })),
    ).toBe(404);
    expect(await status(registry.call(asTask('me'), 'review.drafts_delete', { id: 'l1' }))).toBe(
      404,
    );
  });
});

describe('review.drafts_list', () => {
  it("lists the task's notes and comments for the PR, the user's and the agent's, by file and line", async () => {
    put(row({ id: 'b', filePath: 'b.ts', author: 'user', kind: 'note' }));
    put(row({ id: 'a2', filePath: 'a.ts', startLine: 9, replyTo: 'T1' }));
    put(row({ id: 'a1', filePath: 'a.ts', startLine: 2 }));
    put(row({ id: 'x', viewScope: 'pr:github:13' }));
    const list = (await registry.call(asTask('me'), 'review.drafts_list', { number: 12 })) as {
      id: string;
    }[];
    expect(list.map((d) => d.id)).toEqual(['a1', 'a2', 'b']);
    expect(list[1]).toMatchObject({ replyTo: 'T1', body: 'x', author: 'agent', kind: 'comment' });
    expect(list[2]).toMatchObject({ kind: 'note' });
  });
});

describe('review.summary_get / summary_set', () => {
  it("drafts the review's PR-level summary, replaces it, and clears it", async () => {
    expect(await registry.call(asTask('me'), 'review.summary_get', { number: 12 })).toBeNull();
    expect(
      await registry.call(asTask('me'), 'review.summary_set', { number: 12, body: 'Nice work' }),
    ).toEqual({ body: 'Nice work', author: 'agent' });
    expect(await registry.call(asTask('me'), 'review.summary_get', { number: 12 })).toEqual({
      body: 'Nice work',
      author: 'agent',
    });
    await registry.call(asTask('me'), 'review.summary_set', { number: 12, body: '' });
    expect(await registry.call(asTask('me'), 'review.summary_get', { number: 12 })).toBeNull();
    expect(changed).toEqual(['me', 'me']);
  });

  it("can't reach a sibling's review", async () => {
    expect(
      await status(
        registry.call(asTask('me'), 'review.summary_set', {
          taskId: 'sibling',
          number: 12,
          body: 'x',
        }),
      ),
    ).toBe(404);
  });
});
