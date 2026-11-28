import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { PrDetails } from '../../../shared/types';

const details = (title: string) => ({ number: 4, title, threads: [] }) as unknown as PrDetails;

async function freshStore() {
  vi.resetModules();
  return await import('../projectPrsStore');
}

describe('projectPrsStore.loadDetails', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it("fetches a project PR's details once per update time", async () => {
    api.prDetails = vi.fn(() => Promise.resolve({ success: true, data: details('a') }));
    const { useProjectPrs, prDetailsOf } = await freshStore();
    const load = useProjectPrs.getState().loadDetails;
    expect(await load('p1', 4, 'T1')).toEqual({ ok: true, details: details('a') });
    expect(api.prDetails).toHaveBeenCalledWith({ projectId: 'p1', number: 4 });
    await load('p1', 4, 'T1');
    expect(api.prDetails).toHaveBeenCalledTimes(1);
    await load('p1', 4, 'T2');
    expect(api.prDetails).toHaveBeenCalledTimes(2);
    await load('p2', 4, 'T2');
    expect(api.prDetails).toHaveBeenCalledTimes(3);
    expect(prDetailsOf('p1', 4)(useProjectPrs.getState())).toEqual(details('a'));
  });

  it('fetches again each time the update time is unknown, sharing one under way', async () => {
    api.prDetails = vi.fn(() => Promise.resolve({ success: true, data: details('a') }));
    const { useProjectPrs } = await freshStore();
    const load = useProjectPrs.getState().loadDetails;
    await Promise.all([load('p1', 4, null), load('p1', 4, null)]);
    expect(api.prDetails).toHaveBeenCalledTimes(1);
    await load('p1', 4, null);
    expect(api.prDetails).toHaveBeenCalledTimes(2);
  });

  it("keeps the newer ask's details when an older answer lands after it", async () => {
    let answerOld: (v: unknown) => void = () => {};
    api.prDetails = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (answerOld = r)))
      .mockImplementationOnce(() => Promise.resolve({ success: true, data: details('new') }));
    const { useProjectPrs, prDetailsOf } = await freshStore();
    const load = useProjectPrs.getState().loadDetails;
    const old = load('p1', 4, 'T1');
    await load('p1', 4, 'T2');
    answerOld({ success: true, data: details('old') });
    expect(await old).toEqual({ ok: true, details: details('old') });
    expect(prDetailsOf('p1', 4)(useProjectPrs.getState())?.title).toBe('new');
  });

  it('keeps the last details when a fetch fails, and says why', async () => {
    api.prDetails = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: details('a') })
      .mockResolvedValueOnce({ success: false, error: 'offline' });
    const { useProjectPrs, prDetailsOf } = await freshStore();
    const load = useProjectPrs.getState().loadDetails;
    await load('p1', 4, 'T1');
    expect(await load('p1', 4, 'T2')).toEqual({ ok: false, error: 'offline' });
    expect(prDetailsOf('p1', 4)(useProjectPrs.getState())).toEqual(details('a'));
  });
});
