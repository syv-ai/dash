import { describe, expect, it } from 'vitest';
import type { PrReview, RelevantPr } from '../../../../shared/types';
import {
  DETAILS_FRESH_MS,
  needsDetails,
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
    expect(taskPrList(relevant).map((p) => [p.pr.number, p.side])).toEqual([
      [9, 'from'],
      [4, 'from'],
      [7, 'into'],
    ]);
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
