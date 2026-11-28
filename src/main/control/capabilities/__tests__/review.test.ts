import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { DiffComment, PrRef, PrReview, PrReviewThread } from '../../../../shared/types';
import { ControlError, createRegistry, type Registry } from '../../registry';
import { fakeLookups, makeProject, makeTask } from '../../__tests__/fixtures';
import { registerReviewCapabilities } from '../review';
import { FORGE_CAPABILITIES } from '../../../../shared/forgeCapabilities';

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
/** The PR `dashctl review` defaults to (`defaultReviewPr`), and the PRs `loadReview` was asked for. */
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
      authorUrl: null,
      reactions: [],
    },
  ],
  ...over,
});

const review = (pr: PrRef): PrReview => ({
  ...pr,
  capabilities: FORGE_CAPABILITIES[pr.provider],
  title: 'Guard sessions',
  body: 'Fixes the crash.',
  url: 'https://github.com/o/r/pull/12',
  viewerIsAuthor: true,
  viewerIsRequestedReviewer: false,
  viewerIsAssignee: false,
  viewerCommented: false,
  verdicts: ['comment'],
  base: 'b0',
  head: 'h0',
  threads: [
    thread({ id: 'T3', path: 'src/b.ts', line: 2 }),
    thread({ id: 'T1', line: 20, startLine: 18 }),
    thread({ id: 'T2', line: null, isOutdated: true, resolved: true }),
  ],
  conversation: [
    {
      id: 'C1',
      author: 'bo',
      body: 'LGTM',
      createdAt: '2026-11-21',
      url: 'u/C1',
      authorUrl: null,
      reactions: [],
    },
  ],
  author: 'me',
  authorUrl: null,
  createdAt: '',
  lastActivityAt: '',
  state: 'open',
  baseRef: 'main',
  headRef: 'fix',
  commits: 2,
  behindBase: 1,
  reviewers: [{ name: 'ana', url: null, state: 'commented' }],
  assignees: [],
  issues: [],
  viewerReview: null,
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
/** The PR's thread, by the id of the thread itself or of one of its comments. */
const threadOf: Record<string, string> = {
  T1: 'T1',
  T2: 'T2',
  T3: 'T3',
  'T1-c1': 'T1',
  '4504285548': 'T1',
};
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
  target = { provider: 'github', number: 12 };
  loaded = [];
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
      summaries: createPrReviewSummariesRepo(db),
      changed: (taskId) => void changed.push(taskId),
    }),
    defaultPr: async () => target,
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
    const input = { number: 12, body: 'agreed', kind: 'comment' };
    for (const replyTo of ['T1', '4504285548']) {
      const created = (await registry.call(asTask('me'), 'review.drafts_create', {
        ...input,
        replyTo,
      })) as { id: string };
      expect(comments.get(created.id)!.replyTo).toBe('T1');
    }
  });

  it("refuses a reply to a thread the PR doesn't have, or can't be checked", async () => {
    const input = { number: 12, body: 'agreed', kind: 'comment' };
    expect(
      await status(registry.call(asTask('me'), 'review.drafts_create', { ...input, replyTo: '9' })),
    ).toBe(404);
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

describe('the PR a command is about', () => {
  it("defaults to the task's review-mode PR, else its own, and refuses when there is none", async () => {
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

type View = { id: string; number: number; status?: string; commit?: string | null };
const call = (name: string, input: Record<string, unknown>) =>
  registry.call(asTask('me'), name, input);

describe('PR heads (#233)', () => {
  const line = { number: 12, path: 'a.ts', startLine: 1, body: 'b', kind: 'comment' };
  const reply = { number: 12, body: 'b', kind: 'comment', replyTo: 'T1' };

  it("records the PR's head on a line draft, or the commit given, and none on a reply", async () => {
    const head = (await call('review.drafts_create', line)) as View;
    expect(head).toMatchObject({ commit: heads[12], status: 'current' });
    const given = (await call('review.drafts_create', { ...line, commit: OLD })) as View;
    expect(given).toMatchObject({ commit: OLD, status: 'moved' });
    const replied = (await call('review.drafts_create', reply)) as View;
    expect(comments.get(replied.id)!.commit).toBeNull();
    expect(replied).not.toHaveProperty('status');
  });

  it("still drafts when the PR's head can't be read, not knowing its anchor", async () => {
    const d = (await call('review.drafts_create', { ...line, number: 99 })) as View;
    expect(d).toMatchObject({ commit: null, status: 'unknown' });
  });

  it('refuses a reply on a commit', async () => {
    expect(await status(call('review.drafts_create', { ...reply, commit: OLD }))).toBe(400);
    expect(changed).toEqual([]);
  });

  it('says which drafts were written on the head now, an older one, or not known', async () => {
    put(row({ id: 'cur', commit: heads[12]! }));
    put(row({ id: 'old', commit: OLD, startLine: 5 }));
    put(row({ id: 'unk', startLine: 7 }));
    put(row({ id: 'gone', commit: OLD, viewScope: 'pr:github:99' }));
    const list = (await call('review.drafts_list', { allPrs: true })) as View[];
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
  it('lists every PR with --all-prs, narrowed by kind, author and path', async () => {
    put(row({ id: 'n', kind: 'note', author: 'user' }));
    put(row({ id: 'c', filePath: 'b.ts' }));
    put(row({ id: 'p13', viewScope: 'pr:github:13' }));
    put(row({ id: 'live', viewScope: 'live' }));
    const ids = async (input: Record<string, unknown>) =>
      ((await call('review.drafts_list', input)) as View[]).map((d) => d.id);
    expect(await ids({ allPrs: true })).toEqual(['c', 'n', 'p13']);
    expect(await ids({ allPrs: true, kind: 'note' })).toEqual(['n']);
    expect(await ids({ allPrs: true, author: 'agent' })).toEqual(['c', 'p13']);
    expect(await ids({ number: 12, path: '/b.ts' })).toEqual(['c']);
    // Without either, the task's default PR (12).
    expect(await ids({})).toEqual(['c', 'n']);
    expect(await status(call('review.drafts_list', { allPrs: true, number: 12 }))).toBe(400);
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

  it('refuses a move when the person edits the draft while its head is looked up', async () => {
    put(row({ id: 'd1', text: 'theirs' }));
    heads[14] = 'e'.repeat(40);
    const slow = registry.call(asTask('me'), 'review.drafts_update', { id: 'd1', number: 14 });
    // The person's save lands while the agent's update awaits the head.
    comments.upsertFromUser({ ...comments.get('d1')!, text: 'the person edited this' });
    expect(await status(slow)).toBe(409);
    expect(comments.get('d1')).toMatchObject({
      text: 'the person edited this',
      viewScope: 'pr:github:12',
    });
    delete heads[14];
  });

  it("can't move a reply, which belongs to its thread", async () => {
    put(row({ id: 'r1', replyTo: 'T1' }));
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
      // --all never falls back to the default PR: it names the one it clears.
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
