import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { PrProvider, PrReview } from '../../../shared/types';

const review = (n: number, provider: PrProvider = 'github'): PrReview => ({
  provider,
  number: n,
  title: 't',
  body: '',
  url: 'u',
  viewerIsAuthor: false,
  viewerIsRequestedReviewer: false,
  verdicts: ['comment'],
  base: 'b',
  head: 'h',
  threads: [],
  conversation: [],
  author: 'a',
  authorUrl: null,
  createdAt: '',
  lastActivityAt: '',
  state: 'open',
  baseRef: 'main',
  headRef: 'feat',
  commits: 1,
  behindBase: 0,
  reviewers: [],
  assignees: [],
  checks: [],
  files: [],
});

async function freshStore() {
  vi.resetModules();
  return await import('../prReviewStore');
}

describe('prReviewStore.load', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('fetches a PR review and keeps it per provider and number', async () => {
    api.prReviewLoad = vi.fn(() => Promise.resolve({ success: true, data: review(4, 'ado') }));
    const { usePrReviews, prKey } = await freshStore();
    expect(await usePrReviews.getState().load('p1', '/wt/t1', 4)).toEqual({
      ok: true,
      review: review(4, 'ado'),
    });
    expect(api.prReviewLoad).toHaveBeenCalledWith({ projectId: 'p1', cwd: '/wt/t1', number: 4 });
    expect(usePrReviews.getState().byPr[prKey('ado', 4)]).toEqual(review(4, 'ado'));
  });

  it('shares a fetch of the same PR already under way', async () => {
    api.prReviewLoad = vi.fn(() => Promise.resolve({ success: true, data: review(4) }));
    const { usePrReviews } = await freshStore();
    const [a, b] = await Promise.all([
      usePrReviews.getState().load('p1', '/wt/t1', 4),
      usePrReviews.getState().load('p1', '/wt/t1', 4),
    ]);
    expect(a).toEqual(b);
    expect(api.prReviewLoad).toHaveBeenCalledTimes(1);
    await usePrReviews.getState().load('p1', '/wt/t1', 4);
    expect(api.prReviewLoad).toHaveBeenCalledTimes(2);
  });

  it('a forced fetch follows one under way instead of sharing its stale answer', async () => {
    let answerOld!: () => void;
    const pushed = { ...review(4), head: 'h2' };
    api.prReviewLoad = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerOld = () => resolve({ success: true, data: review(4) });
          }),
      )
      .mockResolvedValue({ success: true, data: pushed });
    const { usePrReviews, prKey } = await freshStore();
    const older = usePrReviews.getState().load('p1', '/wt/t1', 4);
    const forced = usePrReviews.getState().load('p1', '/wt/t1', 4, { force: true });
    const shared = usePrReviews.getState().load('p1', '/wt/t1', 4);
    expect(api.prReviewLoad).toHaveBeenCalledTimes(1);
    answerOld();
    expect(await older).toEqual({ ok: true, review: review(4) });
    expect(await forced).toEqual({ ok: true, review: pushed });
    expect(await shared).toEqual({ ok: true, review: pushed });
    expect(api.prReviewLoad).toHaveBeenCalledTimes(2);
    expect(usePrReviews.getState().byPr[prKey('github', 4)]!.head).toBe('h2');
  });

  it('keeps what it had when a fetch fails, and says why', async () => {
    api.prReviewLoad = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: review(4) })
      .mockResolvedValue({ success: false, error: 'offline' });
    const { usePrReviews, prKey } = await freshStore();
    await usePrReviews.getState().load('p1', '/wt/t1', 4);
    expect(await usePrReviews.getState().load('p1', '/wt/t1', 4)).toEqual({
      ok: false,
      error: 'offline',
    });
    expect(usePrReviews.getState().byPr[prKey('github', 4)]).toEqual(review(4));
  });
});

describe('prReviewStore writes', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  const withThread = (): PrReview => ({
    ...review(4),
    threads: [
      {
        id: 'T1',
        path: 'a.ts',
        line: 3,
        startLine: null,
        side: 'RIGHT',
        isOutdated: false,
        resolved: false,
        comments: [],
      },
    ],
  });

  it('resolves a thread at once, and undoes it when the PR refuses', async () => {
    api.prReviewLoad = vi.fn(() => Promise.resolve({ success: true, data: withThread() }));
    const { usePrReviews, prKey } = await freshStore();
    await usePrReviews.getState().load('p1', '/wt', 4);
    const resolved = () => usePrReviews.getState().byPr[prKey('github', 4)]!.threads[0]!.resolved;

    let answer: (v: unknown) => void = () => {};
    api.prReviewSetResolved = vi.fn(() => new Promise((r) => (answer = r)));
    const pending = usePrReviews.getState().setResolved('p1', '/wt', review(4), 'T1', true);
    expect(resolved()).toBe(true);
    answer({ success: false, error: 'Resource not accessible' });
    expect(await pending).toEqual({
      ok: false,
      error: { kind: 'other', message: 'Resource not accessible' },
    });
    expect(resolved()).toBe(false);
  });

  const posted = { id: 'C9', author: 'me', body: 'Done', createdAt: '', url: '' };
  const poster = { projectId: 'p1', cwd: '/wt', taskId: 't1', review: review(4) };

  it('posts a draft reply, adds it to its thread, and resolves the thread when asked', async () => {
    api.prReviewLoad = vi.fn(() => Promise.resolve({ success: true, data: withThread() }));
    api.prReviewReply = vi.fn(() => Promise.resolve({ success: true, data: posted }));
    const { usePrReviews, prKey } = await freshStore();
    await usePrReviews.getState().load('p1', '/wt', 4);
    const pending = usePrReviews
      .getState()
      .postReply(poster, { id: 'd1', replyTo: 'T1', text: 'Done' }, true);
    expect(usePrReviews.getState().posting).toEqual({ d1: true });
    expect(await pending).toEqual({ ok: true });
    expect(api.prReviewReply).toHaveBeenCalledWith({
      projectId: 'p1',
      cwd: '/wt',
      taskId: 't1',
      number: 4,
      threadId: 'T1',
      body: 'Done',
      draftId: 'd1',
    });
    const thread = usePrReviews.getState().byPr[prKey('github', 4)]!.threads[0]!;
    expect(thread.comments).toEqual([posted]);
    expect(thread.resolved).toBe(true);
    expect(usePrReviews.getState().posting).toEqual({});
  });

  it('keeps the thread as it was when the PR refuses the reply', async () => {
    api.prReviewLoad = vi.fn(() => Promise.resolve({ success: true, data: withThread() }));
    api.prReviewReply = vi.fn(() => Promise.resolve({ success: false, error: 'Not Found' }));
    const { usePrReviews, prKey } = await freshStore();
    await usePrReviews.getState().load('p1', '/wt', 4);
    expect(
      await usePrReviews.getState().postReply(poster, { id: 'd1', replyTo: 'T1', text: 'x' }, true),
    ).toEqual({ ok: false, error: { kind: 'other', message: 'Not Found' } });
    expect(api.prReviewSetResolved).not.toHaveBeenCalled();
    expect(usePrReviews.getState().byPr[prKey('github', 4)]!.threads[0]!.comments).toEqual([]);
  });

  it('says the reply went when only the resolve failed', async () => {
    api.prReviewLoad = vi.fn(() => Promise.resolve({ success: true, data: withThread() }));
    api.prReviewReply = vi.fn(() => Promise.resolve({ success: true, data: posted }));
    api.prReviewSetResolved = vi.fn(() => Promise.resolve({ success: false, error: 'nope' }));
    const { usePrReviews } = await freshStore();
    await usePrReviews.getState().load('p1', '/wt', 4);
    expect(
      await usePrReviews.getState().postReply(poster, { id: 'd1', replyTo: 'T1', text: 'x' }, true),
    ).toEqual({ ok: false, error: { kind: 'other', message: 'nope' }, posted: 1 });
  });

  it('refetches the review after a submit that posted', async () => {
    api.prReviewSubmit = vi.fn(() =>
      Promise.resolve({ success: true, data: { postedDraftIds: ['d1'] } }),
    );
    api.prReviewLoad = vi.fn(() => Promise.resolve({ success: true, data: review(4) }));
    const { usePrReviews } = await freshStore();
    expect(
      await usePrReviews.getState().submit('p1', '/wt', 't1', review(4), 'approve', 'LGTM'),
    ).toEqual({
      ok: true,
    });
    expect(api.prReviewSubmit).toHaveBeenCalledWith({
      projectId: 'p1',
      cwd: '/wt',
      taskId: 't1',
      number: 4,
      verdict: 'approve',
      body: 'LGTM',
    });
    expect(api.prReviewLoad).toHaveBeenCalledTimes(1);
  });

  it("returns the provider's refusal and does not refetch when nothing posted", async () => {
    api.prReviewSubmit = vi.fn(() =>
      Promise.resolve({
        success: true,
        data: { postedDraftIds: [], error: { kind: 'scope', fix: 'gh auth refresh -s repo' } },
      }),
    );
    const { usePrReviews } = await freshStore();
    expect(
      await usePrReviews.getState().submit('p1', '/wt', 't1', review(4), 'comment', 'x'),
    ).toEqual({
      ok: false,
      error: { kind: 'scope', fix: 'gh auth refresh -s repo' },
      posted: 0,
    });
    expect(api.prReviewLoad).not.toHaveBeenCalled();
  });

  it("keeps main's relevant PRs and review mode per task; a mode change shows at once", async () => {
    const relevant = { branch: 'feat', from: [], into: [] };
    const gh = (number: number) => ({ provider: 'github' as const, number });
    api.prReviewRelevant = vi.fn(() =>
      Promise.resolve({ success: true, data: { relevant, mode: gh(9) } }),
    );
    const { usePrReviews } = await freshStore();
    await usePrReviews.getState().loadPrs('t1');
    expect(usePrReviews.getState().prs.t1).toEqual({ relevant, mode: gh(9) });
    usePrReviews.getState().setMode('t1', null);
    expect(usePrReviews.getState().prs.t1).toEqual({ relevant, mode: null });
    expect(api.prReviewSetMode).toHaveBeenCalledWith({ taskId: 't1', pr: null });
  });

  it('keeps the last listing when the forge could not be asked', async () => {
    const relevant = { branch: 'feat', from: [], into: [] };
    const { usePrReviews } = await freshStore();
    api.prReviewRelevant = vi.fn(() =>
      Promise.resolve({ success: true, data: { relevant, mode: null } }),
    );
    await usePrReviews.getState().loadPrs('t1');
    api.prReviewRelevant = vi.fn(() =>
      Promise.resolve({ success: true, data: { relevant: null, mode: null } }),
    );
    await usePrReviews.getState().loadPrs('t1');
    expect(usePrReviews.getState().prs.t1?.relevant).toBe(relevant);
  });

  it('a load under way when the mode changes keeps the new mode', async () => {
    let answer: (v: unknown) => void = () => {};
    api.prReviewRelevant = vi.fn(() => new Promise((r) => (answer = r)));
    const { usePrReviews } = await freshStore();
    const loading = usePrReviews.getState().loadPrs('t1');
    usePrReviews.getState().setMode('t1', { provider: 'github', number: 4 });
    answer({ success: true, data: { relevant: null, mode: null } });
    await loading;
    expect(usePrReviews.getState().prs.t1?.mode).toEqual({ provider: 'github', number: 4 });
  });

  it('marks files viewed at once, saved behind, per task and PR', async () => {
    api.prReviewViewed = vi.fn(() => Promise.resolve({ success: true, data: { 'a.ts': 'b1' } }));
    const { usePrReviews, reviewKey } = await freshStore();
    const key = reviewKey('t1', 'github', 4);
    await usePrReviews.getState().loadViewed('t1', 'github', 4);
    expect(usePrReviews.getState().viewed[key]).toEqual({ 'a.ts': 'b1' });
    usePrReviews.getState().setViewed('t1', 'github', 4, 'b.ts', 'b2');
    usePrReviews.getState().setViewed('t1', 'github', 4, 'a.ts', null);
    expect(usePrReviews.getState().viewed[key]).toEqual({ 'b.ts': 'b2' });
    expect(api.prReviewSetViewed).toHaveBeenLastCalledWith({
      taskId: 't1',
      provider: 'github',
      number: 4,
      path: 'a.ts',
      blob: null,
    });
  });
});

describe('prReviewStore summaries', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    vi.useFakeTimers();
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetWindow();
  });

  it("loads the agent's summary, saves the person's edit once they stop typing", async () => {
    api.prReviewGetSummary = vi.fn(() =>
      Promise.resolve({ success: true, data: { body: 'From agent', author: 'agent' } }),
    );
    const { usePrReviews, reviewKey } = await freshStore();
    const key = reviewKey('t1', 'ado', 7);
    await usePrReviews.getState().loadReview('t1', 'ado', 7);
    expect(usePrReviews.getState().summaries[key]).toEqual({ body: 'From agent', author: 'agent' });
    usePrReviews.getState().setSummary('t1', 'ado', 7, 'Mi');
    usePrReviews.getState().setSummary('t1', 'ado', 7, 'Mine');
    expect(usePrReviews.getState().summaries[key]).toEqual({ body: 'Mine', author: 'user' });
    // A refetch mid-typing doesn't undo the edit.
    await usePrReviews.getState().refreshSummaries('t1');
    expect(api.prReviewGetSummary).toHaveBeenCalledTimes(2);
    expect(usePrReviews.getState().summaries[key]!.body).toBe('Mine');
    vi.advanceTimersByTime(500);
    expect(api.prReviewSetSummary).toHaveBeenCalledTimes(1);
    expect(api.prReviewSetSummary).toHaveBeenCalledWith({
      taskId: 't1',
      provider: 'ado',
      number: 7,
      body: 'Mine',
    });
  });
});
