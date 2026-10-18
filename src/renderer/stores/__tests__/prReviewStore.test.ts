import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { PrProvider, PrReview } from '../../../shared/types';

const review = (n: number, provider: PrProvider = 'github'): PrReview => ({
  provider,
  number: n,
  title: 't',
  url: 'u',
  viewerIsAuthor: false,
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
