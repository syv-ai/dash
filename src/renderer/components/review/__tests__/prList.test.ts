import { describe, expect, it } from 'vitest';
import type { PrDetails, PrReview, PrReviewer, RelevantPr } from '../../../../shared/types';
import {
  DETAILS_FRESH_MS,
  needsDetails,
  headFromFork,
  listedYourPart,
  prHead,
  prOpenByDefault,
  reviewVerdict,
  yourPart,
  prsTabShown,
  taskPrList,
  otherAssignees,
  prCardFacts,
  forkHeadUrl,
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
});

type Viewer = Parameters<typeof yourPart>[0];
const nobody: Viewer = {
  viewerIsAuthor: false,
  viewerIsAssignee: false,
  viewerIsRequestedReviewer: false,
  viewerReview: null,
};
const review = (state: NonNullable<PrReview['viewerReview']>['state'], stale = false) => ({
  state,
  at: '',
  stale,
});
const you = (over: Partial<Viewer>) => yourPart({ ...nobody, ...over });

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

describe('yourPart', () => {
  it('says nothing when the PR asks nothing of the person', () => {
    expect(you({})).toBeNull();
    // Theirs reads in the merge line, a current review in the verdict.
    expect(you({ viewerIsAuthor: true, viewerIsAssignee: true })).toBeNull();
    expect(you({ viewerReview: review('approved') })).toBeNull();
  });

  it('asks them to review first, then flags a review commits landed after, then an assignment', () => {
    expect(
      you({
        viewerIsRequestedReviewer: true,
        viewerReview: review('approved', true),
        viewerIsAssignee: true,
      }),
    ).toBe("You're asked to review it");
    expect(you({ viewerReview: review('approved', true), viewerIsAssignee: true })).toBe(
      'New commits since your approval',
    );
    expect(you({ viewerReview: review('changes_requested', true) })).toBe(
      'New commits since your request for changes',
    );
    expect(you({ viewerIsAssignee: true })).toBe("It's assigned to you");
  });
});

describe('needsDetails', () => {
  const at = 1_000_000;
  it('fetches a PR never fetched', () => {
    expect(needsDetails(undefined, null, at)).toBe(true);
  });

  it('keeps a fresh fetch, and fetches again once it is stale', () => {
    const last = { at, updatedAt: null };
    expect(needsDetails(last, null, at + DETAILS_FRESH_MS)).toBe(false);
    expect(needsDetails(last, null, at + DETAILS_FRESH_MS + 1)).toBe(true);
  });

  it('fetches again at once when the listing says the PR moved', () => {
    const last = { at, updatedAt: '2026-11-01T00:00:00Z' };
    expect(needsDetails(last, '2026-11-01T00:00:00Z', at + 1)).toBe(false);
    expect(needsDetails(last, '2026-11-02T00:00:00Z', at + 1)).toBe(true);
  });
});

describe('otherAssignees', () => {
  it('leaves you out when the You row already says you are assigned', () => {
    expect(
      otherAssignees({ assignees: ['cy', 'me'], viewerIsAssignee: true, viewerName: 'me' }),
    ).toEqual(['cy']);
  });
  it('keeps everyone when you are not assigned or the forge does not name you', () => {
    expect(
      otherAssignees({ assignees: ['cy'], viewerIsAssignee: false, viewerName: 'me' }),
    ).toEqual(['cy']);
    expect(
      otherAssignees({ assignees: ['cy'], viewerIsAssignee: false, viewerName: null }),
    ).toEqual(['cy']);
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

describe('reviewVerdict', () => {
  const r = (state: PrReviewer['state'], o: Partial<PrReviewer> = {}): PrReviewer => ({
    name: state,
    url: null,
    state,
    ...o,
  });
  it('says changes requested when anyone asked for them (an ADO rejection or wait too)', () => {
    expect(reviewVerdict([r('approved'), r('changes_requested')])).toBe('changes_requested');
    expect(reviewVerdict([r('rejected')])).toBe('changes_requested');
    expect(reviewVerdict([r('waiting')])).toBe('changes_requested');
  });
  it('is pending while a required review is to come, approved once in', () => {
    expect(reviewVerdict([r('approved'), r('pending', { required: true })])).toBe('pending');
    expect(reviewVerdict([r('approved_with_suggestions'), r('pending')])).toBe('approved');
  });
  it('leaves out those who declined, and says nothing with no one asked', () => {
    expect(reviewVerdict([r('approved'), r('changes_requested', { declined: true })])).toBe(
      'approved',
    );
    expect(reviewVerdict([r('pending')])).toBe('pending');
    expect(reviewVerdict([r('commented')])).toBeNull();
    expect(reviewVerdict([])).toBeNull();
  });
});

describe('listedYourPart', () => {
  it("reads the listing's facts as the review's would, before any review of theirs is known", () => {
    expect(listedYourPart({ isAuthor: false, isAssignee: true, isRequestedReviewer: false })).toBe(
      "It's assigned to you",
    );
    expect(
      listedYourPart({ isAuthor: true, isAssignee: true, isRequestedReviewer: false }),
    ).toBeNull();
    expect(listedYourPart(null)).toBeNull();
  });
});

describe('prOpenByDefault', () => {
  const one = { branch: 'b', from: [], into: [listed(1)] };
  const own = { branch: 'b', from: [listed(1)], into: [listed(2), listed(3)] };
  const intoOnly = { branch: 'b', from: [], into: [listed(2), listed(3)] };
  it("opens the only PR, or the branch's own; folds the rest", () => {
    expect(prOpenByDefault(one, 0)).toBe(true);
    expect(prOpenByDefault(own, 0)).toBe(true);
    expect(prOpenByDefault(own, 1)).toBe(false);
    expect(prOpenByDefault(intoOnly, 0)).toBe(false);
  });
});

describe('the listing at a glance', () => {
  it("a folded card shows the listing's verdict before any review is fetched", () => {
    expect(prCardFacts({ ...listed(1), verdict: 'approved' }, null).verdict).toBe('approved');
  });

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
