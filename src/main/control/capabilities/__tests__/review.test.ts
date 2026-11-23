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
/** The PR's thread, by the id of the thread itself or of one of its comments. */
const threadOf: Record<string, string> = { PRRT_1: 'PRRT_1', '4504285548': 'PRRT_1' };
/** Each PR's head now; PR 99's can't be read. */
const OLD = 'a'.repeat(40);
const heads: Record<number, string> = { 12: 'c'.repeat(40), 13: 'd'.repeat(40) };
let opened: unknown[];

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
  commit: null,
  author: 'agent',
  kind: 'comment',
  createdAt: '',
  updatedAt: 'v1',
  ...over,
});

/** A stored draft, written as it is (author and all). */
function put(c: DiffComment) {
  db.prepare(
    `INSERT INTO diff_editor_comments (id, task_id, file_path, start_line, end_line, text, sent,
       view_scope, side, reply_to, commit_sha, author, kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`,
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
    c.commit,
    c.author,
    c.kind,
    c.updatedAt,
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
  opened = [];
  registry = createRegistry(fakeLookups([makeProject({ id: 'pA' })], tasks));
  registerReviewCapabilities(registry, {
    providerFor: () => 'github',
    getTask: (id) => tasks.find((t) => t.id === id),
    prHead: async (_task, number) => {
      if (!heads[number]) throw new Error('gh: could not connect');
      return heads[number]!;
    },
    openPr: (task, pr) => void opened.push({ taskId: task.id, ...pr }),
    replyThread: async (_task, _number, ref) => {
      if (ref === 'offline') throw new Error('gh: could not connect');
      return threadOf[ref] ?? null;
    },
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
      commit: heads[12],
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

  it("stores a reply to the PR's thread, named by its id or one of its comments'", async () => {
    const input = { number: 12, path: 'a.ts', startLine: 1, body: 'agreed', kind: 'comment' };
    for (const replyTo of ['PRRT_1', '4504285548']) {
      const created = (await registry.call(asTask('me'), 'review.drafts_create', {
        ...input,
        replyTo,
      })) as { id: string };
      expect(comments.get(created.id)!.replyTo).toBe('PRRT_1');
    }
  });

  it("refuses a reply to a thread the PR doesn't have, or can't be checked", async () => {
    const input = { number: 12, path: 'a.ts', startLine: 1, body: 'agreed', kind: 'comment' };
    expect(
      await status(registry.call(asTask('me'), 'review.drafts_create', { ...input, replyTo: '9' })),
    ).toBe(400);
    expect(
      await status(
        registry.call(asTask('me'), 'review.drafts_create', { ...input, replyTo: 'offline' }),
      ),
    ).toBe(502);
    expect(changed).toEqual([]);
  });
});

describe('review.drafts_update / drafts_delete', () => {
  it('moves the whole range when only its start moves', async () => {
    put(row({ id: 'd1', startLine: 100, endLine: 110 }));
    await registry.call(asTask('me'), 'review.drafts_update', { id: 'd1', startLine: 10 });
    expect(comments.get('d1')).toMatchObject({ startLine: 10, endLine: 20 });
    await registry.call(asTask('me'), 'review.drafts_update', { id: 'd1', startLine: 200 });
    expect(comments.get('d1')).toMatchObject({ startLine: 200, endLine: 210 });
    await registry.call(asTask('me'), 'review.drafts_update', { id: 'd1', endLine: 205 });
    expect(comments.get('d1')).toMatchObject({ startLine: 200, endLine: 205 });
  });

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
    await registry.call(asTask('me'), 'review.drafts_delete', { ids: ['d1'] });
    expect(!!comments.get('d1')).toBe(false);
    expect(changed).toEqual(['me', 'me', 'me']);
  });

  it("changes and deletes the user's drafts too", async () => {
    put(row({ id: 'u1', author: 'user' }));
    await registry.call(asTask('me'), 'review.drafts_update', { id: 'u1', body: 'reworded' });
    expect(comments.get('u1')!.text).toBe('reworded');
    await registry.call(asTask('me'), 'review.drafts_delete', { ids: ['u1'] });
    expect(!!comments.get('u1')).toBe(false);
  });

  it('refuses an update that changes nothing, such as a body piped without --body -', async () => {
    put(row({ id: 'd1' }));
    expect(await status(registry.call(asTask('me'), 'review.drafts_update', { id: 'd1' }))).toBe(
      400,
    );
    expect(changed).toEqual([]);
  });

  it("can't see another task's draft, or a non-PR comment", async () => {
    put(row({ id: 's1', taskId: 'sibling' }));
    put(row({ id: 'l1', viewScope: 'live' }));
    expect(
      await status(registry.call(asTask('me'), 'review.drafts_update', { id: 's1', body: 'x' })),
    ).toBe(404);
    expect(await status(registry.call(asTask('me'), 'review.drafts_delete', { ids: ['l1'] }))).toBe(
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
    ).toMatchObject({ body: 'Nice work', author: 'agent' });
    expect(await registry.call(asTask('me'), 'review.summary_get', { number: 12 })).toMatchObject({
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

type View = { id: string; number: number; status?: string; commit?: string | null };
const call = (name: string, input: Record<string, unknown>) =>
  registry.call(asTask('me'), name, input);

describe('PR heads (#233)', () => {
  const line = { number: 12, path: 'a.ts', startLine: 1, body: 'b', kind: 'comment' };

  it("records the PR's head on a line draft, or the commit given, and none on a reply", async () => {
    const head = (await call('review.drafts_create', line)) as View;
    expect(head).toMatchObject({ commit: heads[12], status: 'current' });
    const given = (await call('review.drafts_create', { ...line, commit: OLD })) as View;
    expect(given).toMatchObject({ commit: OLD, status: 'moved' });
    const reply = (await call('review.drafts_create', { ...line, replyTo: 'PRRT_1' })) as View;
    expect(comments.get(reply.id)!.commit).toBeNull();
    expect(reply).not.toHaveProperty('status');
  });

  it("refuses a line draft when the PR's head can't be read, and a reply on a commit", async () => {
    expect(await status(call('review.drafts_create', { ...line, number: 99 }))).toBe(502);
    expect(
      await status(call('review.drafts_create', { ...line, replyTo: 'PRRT_1', commit: OLD })),
    ).toBe(400);
    expect(changed).toEqual([]);
  });

  it('says which drafts were written on the head now, an older one, or not known', async () => {
    put(row({ id: 'cur', commit: heads[12]! }));
    put(row({ id: 'old', commit: OLD, startLine: 5 }));
    put(row({ id: 'unk', startLine: 7 }));
    put(row({ id: 'gone', commit: OLD, viewScope: 'pr:github:99' }));
    const list = (await call('review.drafts_list', {})) as View[];
    expect(list.map((d) => [d.id, d.number, d.status])).toEqual([
      ['cur', 12, 'current'],
      ['old', 12, 'moved'],
      ['unk', 12, 'unknown'],
      ['gone', 99, 'unknown'],
    ]);
    expect(await call('review.drafts_get', { id: 'old' })).toMatchObject({ status: 'moved' });
  });
});

describe('drafts_list filters and drafts_get (#238)', () => {
  it('lists every PR when no number is given, narrowed by kind, author and path', async () => {
    put(row({ id: 'n', kind: 'note', author: 'user' }));
    put(row({ id: 'c', filePath: 'b.ts' }));
    put(row({ id: 'p13', viewScope: 'pr:github:13' }));
    put(row({ id: 'live', viewScope: 'live' }));
    const ids = async (input: Record<string, unknown>) =>
      ((await call('review.drafts_list', input)) as View[]).map((d) => d.id);
    expect(await ids({})).toEqual(['c', 'n', 'p13']);
    expect(await ids({ kind: 'note' })).toEqual(['n']);
    expect(await ids({ author: 'agent' })).toEqual(['c', 'p13']);
    expect(await ids({ number: 12, path: '/b.ts' })).toEqual(['c']);
  });

  it('gets one draft, or a 404', async () => {
    put(row({ id: 'd1' }));
    expect(await call('review.drafts_get', { id: 'd1' })).toMatchObject({ id: 'd1', number: 12 });
    expect(await status(call('review.drafts_get', { id: 'nope' }))).toBe(404);
  });
});

describe('drafts_update moves (#235)', () => {
  it('moves a draft to another file and PR, keeping its id, text and author, on the head now', async () => {
    put(row({ id: 'd1', author: 'user', text: 'their words', commit: OLD }));
    const moved = (await call('review.drafts_update', {
      id: 'd1',
      number: 13,
      path: 'src/b.ts',
      startLine: 20,
    })) as View;
    expect(moved).toMatchObject({ id: 'd1', number: 13, status: 'current' });
    expect(comments.get('d1')).toMatchObject({
      filePath: 'src/b.ts',
      viewScope: 'pr:github:13',
      startLine: 20,
      endLine: 20,
      text: 'their words',
      author: 'user',
      commit: heads[13],
    });
  });

  it("keeps the anchor when only the text changes, or its own PR's number is given back", async () => {
    put(row({ id: 'd1', commit: OLD }));
    await call('review.drafts_update', { id: 'd1', body: 'reworded', number: 12 });
    expect(comments.get('d1')!.commit).toBe(OLD);
  });

  it("can't move a reply, which belongs to its thread", async () => {
    put(row({ id: 'r1', replyTo: 'PRRT_1' }));
    expect(await status(call('review.drafts_update', { id: 'r1', number: 13 }))).toBe(400);
    expect(await status(call('review.drafts_update', { id: 'r1', path: 'other.ts' }))).toBe(400);
  });
});

describe('versions (#234)', () => {
  it('returns updatedAt, and refuses an update or delete of a draft changed since', async () => {
    put(row({ id: 'd1', updatedAt: 'v2' }));
    expect(await call('review.drafts_get', { id: 'd1' })).toMatchObject({ updatedAt: 'v2' });
    expect(
      await status(call('review.drafts_update', { id: 'd1', body: 'x', ifUnchangedSince: 'v1' })),
    ).toBe(409);
    expect(
      await status(call('review.drafts_delete', { ids: ['d1'], ifUnchangedSince: 'v1' })),
    ).toBe(409);
    expect(comments.get('d1')!.text).toBe('x');
    const updated = (await call('review.drafts_update', {
      id: 'd1',
      body: 'mine',
      ifUnchangedSince: 'v2',
    })) as { updatedAt: string };
    expect(updated.updatedAt).not.toBe('v2');
    expect(changed).toEqual(['me']);
  });

  it('refuses a summary write when the summary changed since', async () => {
    await call('review.summary_set', { number: 12, body: 'first', ifUnchangedSince: '' });
    const { updatedAt } = (await call('review.summary_get', { number: 12 })) as {
      updatedAt: string;
    };
    expect(
      await status(call('review.summary_set', { number: 12, body: 'x', ifUnchangedSince: '' })),
    ).toBe(409);
    await call('review.summary_set', { number: 12, body: 'second', ifUnchangedSince: updatedAt });
    expect(
      await status(
        call('review.summary_set', { number: 12, body: 'x', ifUnchangedSince: updatedAt }),
      ),
    ).toBe(409);
    expect(await call('review.summary_get', { number: 12 })).toMatchObject({ body: 'second' });
  });
});

describe('drafts_delete (#238)', () => {
  beforeEach(() => {
    put(row({ id: 'a', author: 'user', kind: 'note' }));
    put(row({ id: 'b' }));
    put(row({ id: 'c', viewScope: 'pr:github:13' }));
  });
  const left = () => ['a', 'b', 'c'].filter((id) => comments.get(id) !== undefined).sort();

  it('deletes several drafts at once, telling the editor once', async () => {
    expect(await call('review.drafts_delete', { ids: ['a', 'c'] })).toEqual({
      deleted: ['a', 'c'],
    });
    expect(left()).toEqual(['b']);
    expect(changed).toEqual(['me']);
  });

  it("deletes nothing when one id isn't the task's, or isn't on the --number given", async () => {
    expect(await status(call('review.drafts_delete', { ids: ['a', 'nope'] }))).toBe(404);
    expect(await status(call('review.drafts_delete', { ids: ['a', 'c'], number: 12 }))).toBe(400);
    expect(left()).toEqual(['a', 'b', 'c']);
  });

  it("clears a PR's drafts with --all, narrowed by kind and author", async () => {
    expect(await call('review.drafts_delete', { all: true, number: 12, author: 'agent' })).toEqual({
      deleted: ['b'],
    });
    await call('review.drafts_delete', { all: true, number: 12 });
    expect(left()).toEqual(['c']);
  });

  it('refuses a call that names no drafts, or mixes ids and --all', async () => {
    for (const input of [
      {},
      { all: true },
      { ids: ['a'], all: true, number: 12 },
      { ids: ['a'], kind: 'note' },
      { ids: ['a', 'b'], ifUnchangedSince: 'v1' },
    ]) {
      expect(await status(call('review.drafts_delete', input))).toBe(400);
    }
    expect(left()).toEqual(['a', 'b', 'c']);
  });
});

describe('review.open (#239)', () => {
  it("opens the task's diff editor on the PR", async () => {
    await call('review.open', { number: 13 });
    expect(opened).toEqual([{ taskId: 'me', provider: 'github', number: 13 }]);
  });
});
