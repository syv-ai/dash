import { describe, expect, it } from 'vitest';
import type { PrDetails, PrReview, PrReviewer, RelevantPr } from '../../../../shared/types';
import {
  headFromFork,
  prHead,
  prsTabShown,
  taskPrList,
  forkHeadUrl,
  yourStanding,
} from '../prList';

const listed = (number: number): RelevantPr => ({
  number,
  title: `PR ${number}`,
  url: '',
  state: 'open',
  author: 'a',
  headRefName: 'feat',
  baseRefName: 'main',
  provider: 'github',
  fromFork: false,
  draft: false,
  updatedAt: null,
  additions: null,
  deletions: null,
  threads: null,
  ci: null,
  viewer: null,
  issues: null,
  verdict: null,
  headUrl: null,
  commits: null,
});

describe('taskPrList', () => {
  it("lists the branch's own PRs first, then those into it, each in the forge's order", () => {
    const relevant = { branch: 'feat', from: [listed(9), listed(4)], into: [listed(7)] };
    expect(taskPrList(relevant).map((p) => p.number)).toEqual([9, 4, 7]);
  });

  it('is empty until listed', () => {
    expect(taskPrList(null)).toEqual([]);
  });
});

describe('prsTabShown', () => {
  it('shows the tab only while the branch has PRs from or into it', () => {
    expect(prsTabShown(null)).toBe(false);
    expect(prsTabShown({ branch: 'feat', from: [], into: [] })).toBe(false);
    expect(prsTabShown({ branch: null, from: [], into: [] })).toBe(false);
    expect(prsTabShown({ branch: 'feat', from: [], into: [listed(2)] })).toBe(true);
    expect(prsTabShown({ branch: 'feat', from: [listed(2)], into: [] })).toBe(true);
  });
});

describe('prHead', () => {
  const remote = 'https://github.com/acme/app.git';

  it("reads a listed PR before its review is fetched: a draft says draft, no commit count, the author's profile by the remote", () => {
    const pr = { ...listed(5), draft: true, author: 'bo', headRefName: 'feat/x' };
    expect(prHead(pr, null, remote)).toEqual({
      provider: 'github',
      number: 5,
      title: 'PR 5',
      url: '',
      state: 'draft',
      author: 'bo',
      authorUrl: 'https://github.com/bo',
      commits: null,
      baseRef: 'main',
      headRef: 'feat/x',
      headFromFork: false,
      forkHeadUrl: null,
    });
    expect(prHead(pr, null, null).authorUrl).toBeNull();
  });

  it('reads the fetched review once there is one, its commit count where git counted it', () => {
    const fetched = {
      provider: 'github',
      number: 5,
      title: 'Five',
      url: 'u',
      state: 'merged',
      author: 'bo',
      authorUrl: null,
      baseRef: 'main',
      headRef: 'feat/x',
    } as PrDetails;
    const head = prHead(listed(5), { ...fetched, commits: 4 }, remote);
    expect(head).toMatchObject({ state: 'merged', title: 'Five', commits: 4 });
    expect(prHead(listed(5), fetched, remote).commits).toBeNull();
  });
});

describe('headFromFork', () => {
  const relevant = {
    branch: 'main',
    from: [],
    into: [{ ...listed(7), fromFork: true }, listed(8)],
  };
  it("takes the task's listing's word for it", () => {
    expect(headFromFork(7, relevant, 'main')).toBe(true);
    expect(headFromFork(8, relevant, 'main')).toBe(false);
  });
  it("else knows a fork PR by the task's own pr/<number>/<head> branch", () => {
    expect(headFromFork(9, relevant, 'pr/9/fix')).toBe(true);
    expect(headFromFork(9, relevant, 'pr/10/fix')).toBe(false);
    expect(headFromFork(9, null, 'fix')).toBe(false);
  });
});

describe('the listing at a glance', () => {
  it("a fork PR's head links to the fork where the listing gave its page", () => {
    const relevant = {
      branch: 'main',
      from: [],
      into: [{ ...listed(3), fromFork: true, headUrl: 'https://x/fork/tree/feat' }],
    };
    expect(forkHeadUrl(3, relevant)).toBe('https://x/fork/tree/feat');
    expect(prHead({ ...listed(4), fromFork: true, headUrl: 'u' }, null, null).forkHeadUrl).toBe(
      'u',
    );
    expect(forkHeadUrl(9, relevant)).toBeNull();
  });
});

describe('yourStanding', () => {
  const now = Date.parse('2026-11-28T12:00:00Z');
  const d = (over: Partial<Parameters<typeof yourStanding>[0]>) =>
    yourStanding(
      {
        viewerReview: null,
        viewerIsAuthor: false,
        viewerIsRequestedReviewer: false,
        createdAt: '2026-11-28T09:00:00Z',
        ...over,
      },
      now,
    );
  const own = (
    state: NonNullable<PrReview['viewerReview']>['state'],
    at = '2026-11-26T12:00:00Z',
  ) => ({
    state,
    at,
    stale: false,
  });

  it('says what their latest review did, and how long ago', () => {
    expect(d({ viewerReview: own('approved') })).toBe('You approved it 2 days ago');
    expect(d({ viewerReview: own('changes_requested') })).toBe('You requested changes 2 days ago');
    expect(d({ viewerReview: own('waiting') })).toBe(
      'You set it to waiting for the author 2 days ago',
    );
    expect(d({ viewerReview: own('rejected', '') })).toBe('You rejected it');
  });

  it("says it's theirs, asked of them, or not reviewed, so the line is always there", () => {
    expect(d({ viewerIsAuthor: true })).toBe('You opened it 3 hours ago');
    expect(d({ viewerIsRequestedReviewer: true })).toBe('Your review is requested');
    expect(d({})).toBe("You haven't reviewed it");
  });
});
