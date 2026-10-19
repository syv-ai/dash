import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { PrProvider, PrReview } from '../../../shared/types';

const review = (n: number, provider: PrProvider = 'github'): PrReview => ({
  provider,
  number: n,
  title: 't',
  url: 'u',
  viewerIsAuthor: false,
  viewerIsRequestedReviewer: false,
  verdicts: ['comment'],
  base: 'b',
  head: 'h',
  threads: [],
  conversation: [],
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

  it('remembers a review per task and PR, and ends it on a submit that all got through', async () => {
    api.prReviewInReview = vi.fn(() => Promise.resolve({ success: true, data: true }));
    api.prReviewLoad = vi.fn(() => Promise.resolve({ success: true, data: review(4) }));
    const { usePrReviews, reviewKey } = await freshStore();
    const key = reviewKey('t1', 'github', 4);
    await usePrReviews.getState().loadInReview('t1', 'github', 4);
    expect(usePrReviews.getState().inReview[key]).toBe(true);
    usePrReviews.getState().setInReview('t1', 'github', 5, true);
    expect(api.prReviewSetInReview).toHaveBeenCalledWith({
      taskId: 't1',
      provider: 'github',
      number: 5,
      on: true,
    });
    await usePrReviews.getState().submit('p1', '/wt', 't1', review(4), 'comment', '');
    expect(usePrReviews.getState().inReview[key]).toBe(false);
    expect(usePrReviews.getState().inReview[reviewKey('t1', 'github', 5)]).toBe(true);
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
    await usePrReviews.getState().loadSummary('t1', 'ado', 7);
    expect(usePrReviews.getState().summaries[key]).toEqual({ body: 'From agent', author: 'agent' });
    usePrReviews.getState().setSummary('t1', 'ado', 7, 'Mi');
    usePrReviews.getState().setSummary('t1', 'ado', 7, 'Mine');
    expect(usePrReviews.getState().summaries[key]).toEqual({ body: 'Mine', author: 'user' });
    // A refetch mid-typing doesn't undo the edit.
    await usePrReviews.getState().loadSummary('t1', 'ado', 7);
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
