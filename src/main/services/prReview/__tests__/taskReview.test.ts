import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { DiffCommentInput, PrSubmission, SubmitResult } from '../../../../shared/types';

let db: Database.Database;
vi.mock('../../../db/client', () => ({ getRawDb: () => db }));

import { runMigrations } from '../../../db/migrate';
import { createDiffCommentsRepo, type DiffCommentsRepo } from '../../diffCommentsRepo';
import { createPrReviewsInProgressRepo } from '../../prReviewsInProgressRepo';
import { createTaskReviews, type SubmitTarget, type TaskReviews } from '../taskReview';

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

/** An adapter that posts what `posted` names, then answers with `error`. */
function target(posted: (s: PrSubmission) => string[], error?: SubmitResult['error']) {
  const submit = vi.fn(
    async (_ctx: unknown, _n: number, s: PrSubmission): Promise<SubmitResult> => ({
      postedDraftIds: posted(s),
      ...(error ? { error } : {}),
    }),
  );
  const t: SubmitTarget = {
    adapter: { submit },
    ctx: { cwd: '/wt', projectId: 'p1', remote: null },
  };
  return { t, submit };
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
    reviews: createPrReviewsInProgressRepo(db),
    changed: (taskId) => void changed.push(taskId),
  });
  comments.upsertFromUser(draft({ id: 'c1' }));
  comments.upsertFromUser(draft({ id: 'r1', replyTo: 'T9', text: 'agreed' }));
  comments.upsertFromUser(draft({ id: 'n1', kind: 'note' }));
  comments.upsertFromUser(draft({ id: 'other', viewScope: 'pr:github:5' }));
  reviews.setInReview('t1', pr, true);
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

  it('deletes what got through, ends the review and clears the summary', async () => {
    const { t } = target(all);
    expect(await reviews.submit('t1', pr, t, 'comment', '')).toEqual({
      postedDraftIds: ['c1', 'r1'],
    });
    expect(ids()).toEqual(['n1', 'other']);
    expect(changed).toEqual(['t1']);
    expect(reviews.isInReview('t1', pr)).toBe(false);
    expect(reviews.getSummary('t1', pr)).toBeNull();
  });

  it('keeps the review, its summary and the rest of the drafts after a partial post', async () => {
    const error = { kind: 'other', message: 'rate limited' } as const;
    const { t } = target(() => ['c1'], error);
    expect(await reviews.submit('t1', pr, t, 'comment', '')).toEqual({
      postedDraftIds: ['c1'],
      error,
    });
    expect(ids()).toEqual(['n1', 'other', 'r1']);
    expect(changed).toEqual(['t1']);
    expect(reviews.isInReview('t1', pr)).toBe(true);
    expect(reviews.getSummary('t1', pr)).toEqual({ body: 'Looks good', author: 'agent' });
  });

  it('changes nothing when the provider refuses before posting', async () => {
    const { t } = target(() => [], { kind: 'pending-review' });
    await reviews.submit('t1', pr, t, 'comment', '');
    expect(ids()).toEqual(['c1', 'n1', 'other', 'r1']);
    expect(changed).toEqual([]);
    expect(reviews.isInReview('t1', pr)).toBe(true);
  });

  it('ends the review on a verdict with no drafts, without telling the editor', async () => {
    comments.deleteByIds(['c1', 'r1']);
    const { t } = target(() => []);
    await reviews.submit('t1', pr, t, 'approve', '');
    expect(changed).toEqual([]);
    expect(reviews.isInReview('t1', pr)).toBe(false);
  });
});

describe('TaskReviews drafts', () => {
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
    reviews.saveAgentDraft({ ...draft({ id: 'a1' }), replyTo: null, kind: 'comment' });
    reviews.deleteAgentDraft('t1', 'a1');
    expect(changed).toEqual(['t1', 't1', 't1']);
  });
});
