import { describe, it, expect, vi } from 'vitest';
import type { PullRequestInfo } from '../../../../shared/types';
import { prsForCheckout, type CheckoutGit } from '../checkoutPrs';

const ctx = { cwd: '/wt', projectId: 'p1', remote: null };
const pr = (
  number: number,
  state: PullRequestInfo['state'],
  headSha?: string,
): PullRequestInfo => ({
  number,
  title: `PR ${number}`,
  url: `u${number}`,
  state,
  provider: 'github',
  headSha,
});
const git = (branch: string | null, movedPast = false): CheckoutGit => ({
  getBranch: async () => branch,
  hasMovedPast: async () => movedPast,
});

describe('prsForCheckout', () => {
  it("asks the forge for the live branch's PRs and flags the current ones", async () => {
    const prsFrom = vi.fn(async () => [pr(3, 'merged', 'a'), pr(5, 'open')]);
    const prs = await prsForCheckout({ prsFrom }, ctx, 'main', git('feature'));
    expect(prsFrom).toHaveBeenCalledWith(ctx, 'feature');
    expect(prs.map((p) => [p.number, p.current])).toEqual([
      [5, true],
      [3, false],
    ]);
  });

  it('keeps a merged PR current until the branch moves past it', async () => {
    const prsFrom = async () => [pr(3, 'merged', 'a')];
    expect((await prsForCheckout({ prsFrom }, ctx, 'main', git('f')))[0]?.current).toBe(true);
    expect((await prsForCheckout({ prsFrom }, ctx, 'main', git('f', true)))[0]?.current).toBe(
      false,
    );
  });

  it('asks nothing on the default branch or a detached HEAD', async () => {
    const prsFrom = vi.fn(async () => [pr(1, 'open')]);
    expect(await prsForCheckout({ prsFrom }, ctx, 'main', git('main'))).toEqual([]);
    expect(await prsForCheckout({ prsFrom }, ctx, 'main', git(null))).toEqual([]);
    expect(prsFrom).not.toHaveBeenCalled();
  });
});
