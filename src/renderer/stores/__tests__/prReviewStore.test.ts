import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { PrReview } from '../../../shared/types';

const review = (n: number): PrReview => ({
  number: n,
  url: 'u',
  base: 'b',
  head: 'h',
  threads: [],
});

async function freshStore() {
  vi.resetModules();
  return (await import('../prReviewStore')).usePrReviews;
}

describe('prReviewStore.load', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it("fetches a task's PR review and keeps it per task", async () => {
    api.githubGetPrReview = vi.fn(() => Promise.resolve({ success: true, data: review(4) }));
    const store = await freshStore();
    expect(await store.getState().load('t1', '/wt/t1', 4)).toEqual(review(4));
    expect(api.githubGetPrReview).toHaveBeenCalledWith({ cwd: '/wt/t1', number: 4 });
    expect(store.getState().byTask.t1).toEqual(review(4));
  });

  it('keeps what it had when a fetch fails', async () => {
    api.githubGetPrReview = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: review(4) })
      .mockResolvedValue({ success: false, error: 'offline' });
    const store = await freshStore();
    await store.getState().load('t1', '/wt/t1', 4);
    expect(await store.getState().load('t1', '/wt/t1', 4)).toBeNull();
    expect(store.getState().byTask.t1).toEqual(review(4));
  });
});
