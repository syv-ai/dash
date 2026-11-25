import { describe, expect, it, vi } from 'vitest';
import type { PullRequest } from '../../../../shared/types';
import { groupRelevantPrs, listRelevantPrs } from '../relevantPrs';

const pr = (number: number, headRefName: string, baseRefName: string, state = 'open') =>
  ({ number, headRefName, baseRefName, state }) as PullRequest;

describe('groupRelevantPrs', () => {
  it('keeps open PRs whose head or base is the branch, newest first', () => {
    const got = groupRelevantPrs(
      'feat',
      [pr(3, 'feat', 'main'), pr(9, 'feat', 'main'), pr(4, 'feat', 'main', 'merged')],
      [pr(7, 'sub', 'feat'), pr(8, 'other', 'main')],
    );
    expect(got.branch).toBe('feat');
    expect(got.from.map((p) => p.number)).toEqual([9, 3]);
    expect(got.into.map((p) => p.number)).toEqual([7]);
  });

  it("drops a match on a different branch (a fork's same-named head is the forge's)", () => {
    expect(groupRelevantPrs('feat', [pr(1, 'feature', 'main')], []).from).toEqual([]);
  });
});

describe('listRelevantPrs', () => {
  it('asks the forge for both directions', async () => {
    const list = vi.fn(async (f: { head?: string; base?: string }) =>
      f.head ? [pr(2, 'feat', 'main')] : [pr(5, 'x', 'feat')],
    );
    const got = await listRelevantPrs(list, 'feat');
    expect(list).toHaveBeenCalledWith({ head: 'feat' });
    expect(list).toHaveBeenCalledWith({ base: 'feat' });
    expect(got.from.map((p) => p.number)).toEqual([2]);
    expect(got.into.map((p) => p.number)).toEqual([5]);
  });

  it('lists nothing on a detached HEAD, without asking', async () => {
    const list = vi.fn();
    expect(await listRelevantPrs(list, null)).toEqual({ branch: null, from: [], into: [] });
    expect(list).not.toHaveBeenCalled();
  });
});
