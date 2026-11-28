import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { DiffCommentInput, PrSubmission, SubmitResult } from '../../../../shared/types';

let db: Database.Database;
vi.mock('../../../db/client', () => ({ getRawDb: () => db }));

import { runMigrations } from '../../../db/migrate';
import { createDiffCommentsRepo, type DiffCommentsRepo } from '../../diffCommentsRepo';
import { createPrReviewSummariesRepo } from '../../prReviewSummariesRepo';
import {
  createTaskReviews,
  type ReplyTarget,
  type SubmitTarget,
  type TaskReviews,
} from '../taskReview';

const pr = { provider: 'github', number: 4 } as const;

let comments: DiffCommentsRepo;
let reviews: TaskReviews;
let changed: string[];

const draft = (over: Partial<DiffCommentInput> & { id: string }): DiffCommentInput => ({
  taskId: 't1',
  filePath: 'src/a.ts',
  startLine: 2,
  endLine: 3,
  text: over.id,
  sent: false,
  viewScope: 'pr:github:4',
  kind: 'comment',
  ...over,
});

/** An adapter that posts what `posted` names, then answers with `error`; the PR is at `head`. */
function target(
  posted: (s: PrSubmission) => string[],
  error?: SubmitResult['error'],
  headNow = 'H2',
) {
  const submit = vi.fn(
    async (_ctx: unknown, _n: number, s: PrSubmission): Promise<SubmitResult> => ({
      postedDraftIds: posted(s),
      ...(error ? { error } : {}),
    }),
  );
  const head = vi.fn(async () => headNow);
  const t: SubmitTarget = {
    adapter: { submit, head },
    ctx: { cwd: '/wt', projectId: 'p1', remote: null },
  };
  return { t, submit, head };
}
const all = (s: PrSubmission) => [...s.comments, ...s.replies].map((d) => d.draftId);

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations();
  db.prepare(`INSERT INTO projects (id, name, path) VALUES ('p1', 'p', '/repo')`).run();
  db.prepare(
    `INSERT INTO tasks (id, project_id, name, branch, path) VALUES ('t1', 'p1', 't', 'b', '/repo')`,
  ).run();
  comments = createDiffCommentsRepo(db);
  changed = [];
  reviews = createTaskReviews({
    comments,
    summaries: createPrReviewSummariesRepo(db),
    changed: (taskId) => void changed.push(taskId),
  });
  comments.upsertFromUser(draft({ id: 'c1' }));
  comments.upsertFromUser(draft({ id: 'r1', replyTo: 'T9', text: 'agreed' }));
  comments.upsertFromUser(draft({ id: 'n1', kind: 'note' }));
  comments.upsertFromUser(draft({ id: 'other', viewScope: 'pr:github:5' }));
  reviews.setSummary('t1', pr, { body: 'Looks good', author: 'agent' });
  changed = [];
});

const ids = () =>
  comments
    .listByTask('t1')
    .map((c) => c.id)
    .sort();

describe('TaskReviews.submit', () => {
  it("posts the PR's comments and replies, not its notes or another PR's", async () => {
    const { t, submit } = target(() => []);
    await reviews.submit('t1', pr, t, 'approve', 'LGTM');
    expect(submit).toHaveBeenCalledWith(t.ctx, 4, {
      verdict: 'approve',
      body: 'LGTM',
      comments: [{ draftId: 'c1', path: 'src/a.ts', startLine: 2, endLine: 3, body: 'c1' }],
      replies: [{ draftId: 'r1', threadId: 'T9', body: 'agreed' }],
    });
  });

  it('deletes what got through and clears the summary', async () => {
    const { t } = target(all);
    expect(await reviews.submit('t1', pr, t, 'comment', '')).toEqual({
      postedDraftIds: ['c1', 'r1'],
    });
    expect(ids()).toEqual(['n1', 'other']);
    expect(changed).toEqual(['t1']);
    expect(reviews.getSummary('t1', pr)).toBeNull();
  });

  it('keeps the summary and the rest of the drafts after a partial post', async () => {
    const error = { kind: 'other', message: 'rate limited' } as const;
    const { t } = target(() => ['c1'], error);
    expect(await reviews.submit('t1', pr, t, 'comment', '')).toEqual({
      postedDraftIds: ['c1'],
      error,
    });
    expect(ids()).toEqual(['n1', 'other', 'r1']);
    expect(changed).toEqual(['t1']);
    expect(reviews.getSummary('t1', pr)).toMatchObject({ body: 'Looks good', author: 'agent' });
  });

  it('changes nothing when the provider refuses before posting', async () => {
    const { t } = target(() => [], { kind: 'pending-review' });
    await reviews.submit('t1', pr, t, 'comment', '');
    expect(ids()).toEqual(['c1', 'n1', 'other', 'r1']);
    expect(changed).toEqual([]);
    expect(reviews.getSummary('t1', pr)).not.toBeNull();
  });

  it('clears the summary on a verdict with no drafts, without telling the editor', async () => {
    comments.deleteByIds(['c1', 'r1']);
    const { t } = target(() => []);
    await reviews.submit('t1', pr, t, 'approve', '');
    expect(changed).toEqual([]);
    expect(reviews.getSummary('t1', pr)).toBeNull();
  });
});

describe('TaskReviews.reply', () => {
  const posted = {
    id: 'C9',
    author: 'me',
    body: 'agreed',
    createdAt: 'now',
    url: 'u/C9',
    authorUrl: null,
    reactions: [],
  };
  const replyTarget = (fail = false) => {
    const reply = vi.fn(async () => {
      if (fail) throw new Error('GraphQL: Not Found');
      return posted;
    });
    const t: ReplyTarget = {
      adapter: { reply },
      ctx: { cwd: '/wt', projectId: 'p1', remote: null },
    };
    return { t, reply };
  };

  it('posts the reply, deletes its draft and tells the editor', async () => {
    const { t, reply } = replyTarget();
    expect(
      await reviews.reply('t1', pr, t, { threadId: 'T9', body: 'agreed', draftId: 'r1' }),
    ).toEqual(posted);
    expect(reply).toHaveBeenCalledWith(t.ctx, 4, 'T9', 'agreed');
    expect(ids()).toEqual(['c1', 'n1', 'other']);
    expect(changed).toEqual(['t1']);
  });

  it("leaves another task's draft alone, and keeps the draft when the PR refuses", async () => {
    await reviews.reply('t2', pr, replyTarget().t, { threadId: 'T9', body: 'x', draftId: 'r1' });
    expect(ids()).toContain('r1');
    await expect(
      reviews.reply('t1', pr, replyTarget(true).t, { threadId: 'T9', body: 'x', draftId: 'r1' }),
    ).rejects.toThrow('Not Found');
    expect(ids()).toContain('r1');
  });
});

describe('TaskReviews.submit and a PR that moved', () => {
  it('holds back a line comment written on an older head, as a draft', async () => {
    comments.upsertFromUser(draft({ id: 'c1', commit: 'H1' }));
    comments.upsertFromUser(draft({ id: 'c2', commit: 'H2', startLine: 9, endLine: 9 }));
    const { t, submit } = target(all, undefined, 'H2');
    expect(await reviews.submit('t1', pr, t, 'comment', '')).toEqual({
      postedDraftIds: ['c2', 'r1'],
      heldBackDraftIds: ['c1'],
    });
    expect(submit.mock.calls[0]![2].comments.map((c) => c.draftId)).toEqual(['c2']);
    expect(ids()).toEqual(['c1', 'n1', 'other']);
    expect(reviews.getSummary('t1', pr)).toBeNull();
  });

  it("posts nothing when every comment is held back and there's nothing else to say", async () => {
    comments.deleteByIds(['r1']);
    comments.upsertFromUser(draft({ id: 'c1', commit: 'H1' }));
    const { t, submit } = target(all, undefined, 'H2');
    expect(await reviews.submit('t1', pr, t, 'comment', ' ')).toEqual({
      postedDraftIds: [],
      heldBackDraftIds: ['c1'],
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("posts nothing, and says why, when the PR's head can't be read", async () => {
    comments.upsertFromUser(draft({ id: 'c1', commit: 'H1' }));
    const { t, submit, head } = target(all);
    head.mockRejectedValueOnce(new Error('offline'));
    const result = await reviews.submit('t1', pr, t, 'comment', '');
    expect(result.postedDraftIds).toEqual([]);
    expect(result.error).toMatchObject({ kind: 'other' });
    expect((result.error as { message: string }).message).toContain('offline');
    expect(submit).not.toHaveBeenCalled();
  });

  it("posts drafts that don't know their head, without asking for it", async () => {
    const { t, head } = target(all);
    expect((await reviews.submit('t1', pr, t, 'comment', '')).heldBackDraftIds).toBeUndefined();
    expect(head).not.toHaveBeenCalled();
  });
});

describe('TaskReviews drafts', () => {
  it('lists the drafts of every PR', () => {
    comments.upsertFromUser(draft({ id: 'live', viewScope: 'live', kind: 'note' }));
    expect(
      reviews
        .allDrafts('t1')
        .map((c) => c.id)
        .sort(),
    ).toEqual(['c1', 'n1', 'other', 'r1']);
  });

  it("finds the task's PR drafts only", () => {
    comments.upsertFromUser(draft({ id: 'live', viewScope: 'live', kind: 'note' }));
    expect(reviews.draft('t1', 'c1')?.id).toBe('c1');
    expect(reviews.draft('t1', 'live')).toBeUndefined();
    expect(reviews.draft('t2', 'c1')).toBeUndefined();
    expect(
      reviews
        .drafts('t1', pr)
        .map((c) => c.id)
        .sort(),
    ).toEqual(['c1', 'n1', 'r1']);
  });

  it("tells the editor about an agent's writes, not the person's", () => {
    reviews.setSummary('t1', pr, { body: 'mine', author: 'user' });
    expect(changed).toEqual([]);
    reviews.setSummary('t1', pr, { body: 'theirs', author: 'agent' });
    reviews.saveAgentDraft({
      ...draft({ id: 'a1' }),
      replyTo: null,
      commit: null,
      kind: 'comment',
    });
    reviews.deleteAgentDrafts('t1', ['a1']);
    reviews.deleteAgentDrafts('t1', []);
    expect(changed).toEqual(['t1', 't1', 't1']);
  });
});
