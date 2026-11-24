import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { DiffComment, PrRef, PrReview, PrReviewThread } from '../../../../shared/types';
import { ControlError, createRegistry, type Registry } from '../../registry';
import { fakeLookups, makeProject, makeTask } from '../../__tests__/fixtures';
import { registerReviewCapabilities } from '../review';

let db: Database.Database;
vi.mock('../../../db/client', () => ({ getRawDb: () => db }));

import { runMigrations } from '../../../db/migrate';
import { createDiffCommentsRepo, type DiffCommentsRepo } from '../../../services/diffCommentsRepo';
import { createPrReviewSummariesRepo } from '../../../services/prReviewSummariesRepo';
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
/** The task's review target (`effectiveReviewTarget`), and the PRs `loadReview` was asked for. */
let target: PrRef | null;
let loaded: PrRef[];

const thread = (over: Partial<PrReviewThread> & { id: string }): PrReviewThread => ({
  path: 'src/a.ts',
  line: 10,
  startLine: null,
  side: 'RIGHT',
  isOutdated: false,
  resolved: false,
  comments: [
    {
      id: `${over.id}-c1`,
      author: 'ana',
      body: 'Why?',
      createdAt: '2026-11-20',
      url: `u/${over.id}`,
    },
  ],
  ...over,
});

const review = (pr: PrRef): PrReview => ({
  ...pr,
  title: 'Guard sessions',
  body: 'Fixes the crash.',
  url: 'https://github.com/o/r/pull/12',
  viewerIsAuthor: true,
  viewerIsRequestedReviewer: false,
  verdicts: ['comment'],
  base: 'b0',
  head: 'h0',
  threads: [
    thread({ id: 'T3', path: 'src/b.ts', line: 2 }),
    thread({ id: 'T1', line: 20, startLine: 18 }),
    thread({ id: 'T2', line: null, isOutdated: true, resolved: true }),
  ],
  conversation: [{ id: 'C1', author: 'bo', body: 'LGTM', createdAt: '2026-11-21', url: 'u/C1' }],
  author: 'me',
  state: 'open',
  baseRef: 'main',
  headRef: 'fix',
  commits: 2,
  behindBase: 1,
  reviewers: [{ name: 'ana', state: 'commented' }],
  assignees: [],
  checks: [{ name: 'ci', state: 'passing', url: 'https://ci' }],
  files: [
    { path: 'src/a.ts', status: 'modified', additions: 3, deletions: 1, blob: 'x' },
    {
      path: 'src/c.ts',
      oldPath: 'src/b.ts',
      status: 'renamed',
      additions: 0,
      deletions: 0,
      blob: 'y',
    },
  ],
});

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
  target = { provider: 'github', number: 12 };
  loaded = [];
  registry = createRegistry(fakeLookups([makeProject({ id: 'pA' })], tasks));
  registerReviewCapabilities(registry, {
    providerFor: () => 'github',
    getTask: (id) => tasks.find((t) => t.id === id),
    reviews: createTaskReviews({
      comments,
      summaries: createPrReviewSummariesRepo(db),
      changed: (taskId) => void changed.push(taskId),
    }),
    reviewTarget: async () => target,
    loadReview: async (_task, pr) => {
      loaded.push(pr);
      return review(pr);
    },
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

describe('the PR a command is about', () => {
  it("defaults to the task's review target, and refuses when there is none", async () => {
    target = { provider: 'github', number: 7 };
    const created = (await registry.call(asTask('me'), 'review.drafts_create', {
      path: 'a.ts',
      startLine: 1,
      body: 'b',
      kind: 'note',
    })) as { id: string };
    expect(comments.get(created.id)!.viewScope).toBe('pr:github:7');
    await registry.call(asTask('me'), 'review.pr', {});
    expect(loaded).toEqual([{ provider: 'github', number: 7 }]);

    target = null;
    await expect(registry.call(asTask('me'), 'review.drafts_list', {})).rejects.toMatchObject({
      status: 400,
      message: 'No pull request to review: pass --number',
    });
    expect(await status(registry.call(asTask('me'), 'review.drafts_list', { number: 3 }))).toBe(
      200,
    );
  });
});

describe('review.pr', () => {
  it('gives the overview, with the conversation only when asked', async () => {
    const pr = (await registry.call(asTask('me'), 'review.pr', { number: 12 })) as Record<
      string,
      unknown
    >;
    expect(pr).toMatchObject({
      provider: 'github',
      number: 12,
      title: 'Guard sessions',
      viewerIsAuthor: true,
      baseRef: 'main',
      headRef: 'fix',
      behindBase: 1,
      checks: [{ name: 'ci', state: 'passing' }],
      files: [
        { path: 'src/a.ts', status: 'modified', additions: 3, deletions: 1 },
        { path: 'src/c.ts', oldPath: 'src/b.ts', status: 'renamed', additions: 0, deletions: 0 },
      ],
    });
    expect(pr).not.toHaveProperty('threads');
    expect(pr).not.toHaveProperty('conversation');
    expect(pr.files).toEqual([
      expect.not.objectContaining({ blob: expect.anything() }),
      expect.anything(),
    ]);
    const withTalk = await registry.call(asTask('me'), 'review.pr', { conversation: true });
    expect(withTalk).toMatchObject({
      conversation: [{ id: 'C1', author: 'bo', body: 'LGTM', createdAt: '2026-11-21' }],
    });
  });
});

describe('review.threads', () => {
  it('lists the unresolved threads by file and line, or the resolved ones, or all', async () => {
    const ids = async (state?: string) =>
      (
        (await registry.call(asTask('me'), 'review.threads', state ? { state } : {})) as {
          id: string;
        }[]
      ).map((t) => t.id);
    expect(await ids()).toEqual(['T1', 'T3']);
    expect(await ids('resolved')).toEqual(['T2']);
    expect(await ids('all')).toEqual(['T2', 'T1', 'T3']);
    const [t1] = (await registry.call(asTask('me'), 'review.threads', {})) as unknown[];
    expect(t1).toEqual({
      id: 'T1',
      path: 'src/a.ts',
      line: 20,
      startLine: 18,
      side: 'RIGHT',
      outdated: false,
      resolved: false,
      url: 'u/T1',
      comments: [{ id: 'T1-c1', author: 'ana', body: 'Why?', createdAt: '2026-11-20' }],
    });
  });
});

describe('review.drafts_create --reply-to', () => {
  it("drafts a reply on its thread's lines", async () => {
    const created = (await registry.call(asTask('me'), 'review.drafts_create', {
      replyTo: 'T1',
      body: 'Fixed in 3f2a.',
      kind: 'comment',
    })) as { id: string };
    expect(comments.get(created.id)).toMatchObject({
      filePath: 'src/a.ts',
      startLine: 18,
      endLine: 20,
      replyTo: 'T1',
      kind: 'comment',
      viewScope: 'pr:github:12',
    });
    const outdated = (await registry.call(asTask('me'), 'review.drafts_create', {
      replyTo: 'T2',
      body: 'x',
      kind: 'comment',
    })) as { id: string };
    expect(comments.get(outdated.id)).toMatchObject({ startLine: 1, endLine: 1 });
  });

  it('refuses a note, given lines, an unknown thread, and neither lines nor a thread', async () => {
    const reply = { replyTo: 'T1', body: 'b', kind: 'comment' };
    const call = (input: object) =>
      status(registry.call(asTask('me'), 'review.drafts_create', input));
    expect(await call({ ...reply, kind: 'note' })).toBe(400);
    expect(await call({ ...reply, path: 'a.ts', startLine: 1 })).toBe(400);
    expect(await call({ ...reply, replyTo: 'nope' })).toBe(404);
    expect(await call({ body: 'b', kind: 'comment' })).toBe(400);
    expect(await call({ body: 'b', kind: 'comment', path: 'a.ts' })).toBe(400);
    expect(changed).toEqual([]);
  });

  it("won't turn a reply into a note", async () => {
    put(row({ id: 'r1', replyTo: 'T1' }));
    expect(
      await status(registry.call(asTask('me'), 'review.drafts_update', { id: 'r1', kind: 'note' })),
    ).toBe(400);
  });
});
