import { describe, expect, it } from 'vitest';
import type { PrDetails, PrReview, PrReviewer, RelevantPr } from '../../../../shared/types';
import {
  DETAILS_FRESH_MS,
  needsDetails,
  headFromFork,
  listedInvolvement,
  prHead,
  prOpenByDefault,
  reviewVerdict,
  prInvolvement,
  prsTabShown,
  taskPrList,
  otherAssignees,
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
});

type Viewer = Parameters<typeof prInvolvement>[0];
const nobody: Viewer = {
  viewerIsAuthor: false,
  viewerIsAssignee: false,
  viewerIsRequestedReviewer: false,
  viewerReview: null,
  viewerCommented: false,
};
const review = (state: NonNullable<PrReview['viewerReview']>['state'], stale = false) => ({
  state,
  at: '',
  stale,
});
const labels = (over: Partial<Viewer>) => prInvolvement({ ...nobody, ...over }).map((i) => i.label);

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

describe('prInvolvement', () => {
  it('says nothing when the person is no part of the PR', () => {
    expect(labels({})).toEqual([]);
  });

  it("reads in the forge sidebar's order: author, assigned, requested, reviewed, commented", () => {
    expect(
      labels({
        viewerIsAuthor: true,
        viewerIsAssignee: true,
        viewerIsRequestedReviewer: true,
        viewerReview: review('approved'),
        viewerCommented: true,
      }),
    ).toEqual(['Author', 'Assigned', 'Review requested', 'Approved', 'Commented']);
  });

  it('says when commits have landed since the last review', () => {
    expect(labels({ viewerReview: review('changes_requested', true) })).toEqual([
      'Changes requested · new commits since',
    ]);
  });

  it('says Commented once when the review was itself a comment', () => {
    expect(labels({ viewerReview: review('commented'), viewerCommented: true })).toEqual([
      'Commented',
    ]);
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

describe('listedInvolvement', () => {
  it("words the listing's facts as the review's would", () => {
    expect(
      listedInvolvement({ isAuthor: true, isAssignee: true, isRequestedReviewer: false }).map(
        (i) => i.label,
      ),
    ).toEqual(['Author', 'Assigned']);
    expect(listedInvolvement(null)).toEqual([]);
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
