import { describe, expect, it } from 'vitest';
import type { PrReviewer } from '../../../../shared/types';
import {
  commentRole,
  commentRoleTip,
  diffTotals,
  mergeVerb,
  prDateTime,
  reviewerRoster,
  threadsResolved,
} from '../labels';

describe('diffTotals', () => {
  it('counts the files and totals their lines', () => {
    const f = (additions: number, deletions: number) => ({ additions, deletions });
    expect(diffTotals([f(3, 1), f(10, 0)])).toEqual({ files: 2, additions: 13, deletions: 1 });
    expect(diffTotals([])).toEqual({ files: 0, additions: 0, deletions: 0 });
  });
});

describe('reviewerRoster', () => {
  const r = (name: string, state: PrReviewer['state']): PrReviewer => ({ name, url: null, state });

  it('orders reviewers by where they stand, verdicts first, requests last', () => {
    const roster = reviewerRoster([
      r('dee', 'pending'),
      r('ann', 'approved'),
      r('cy', 'changes_requested'),
      r('bo', 'approved'),
      r('eve', 'commented'),
    ]);
    expect(roster.map((x) => x.name)).toEqual(['ann', 'bo', 'cy', 'eve', 'dee']);
  });

  it('puts those who declined last, whatever their vote', () => {
    const roster = reviewerRoster([
      { ...r('ann', 'pending'), declined: true },
      r('bo', 'pending'),
      { ...r('cy', 'approved'), declined: true, required: true },
    ]);
    expect(roster.map((x) => x.name)).toEqual(['bo', 'ann', 'cy']);
  });

  it('is empty without reviewers', () => {
    expect(reviewerRoster([])).toEqual([]);
  });
});

describe('threadsResolved', () => {
  it('says how many of the threads are resolved', () => {
    expect(threadsResolved([{ resolved: true }, { resolved: false }])).toBe('(1 of 2 resolved)');
    expect(threadsResolved([])).toBeNull();
  });
});

describe('prDateTime', () => {
  it('reads an ISO date in the given clock, and nothing for a bad one', () => {
    expect(prDateTime('2026-11-26T09:00:00Z', { locale: 'en-GB', timeZone: 'UTC' })).toBe(
      'Thu 26/11/2026, 09:00',
    );
    expect(prDateTime('')).toBe('');
  });
});

describe('mergeVerb', () => {
  it('reads by state', () => {
    expect(mergeVerb('open')).toBe('wants to merge');
    expect(mergeVerb('open', true)).toBe('want to merge');
    expect(mergeVerb('draft')).toBe('wants to merge');
    expect(mergeVerb('merged')).toBe('merged');
    expect(mergeVerb('closed')).toBe('wanted to merge');
  });
});

describe('commentRole', () => {
  const pr = { author: 'Ada', reviewers: [{ name: 'bob' }, { name: 'ada' }] };

  it("names the PR's author, even when also listed as a reviewer", () => {
    expect(commentRole('ada', pr)).toBe('Author');
  });

  it('names an assigned or requested reviewer', () => {
    expect(commentRole('Bob', pr)).toBe('Reviewer');
  });

  it('says nothing of anyone else', () => {
    expect(commentRole('carol', pr)).toBeNull();
  });
});

describe('commentRoleTip', () => {
  const pr = {
    reviewers: [
      { name: 'bob', state: 'approved' as const },
      { name: 'cy', state: 'changes_requested' as const },
      { name: 'dee', state: 'pending' as const },
    ],
  };

  it('says the author opened the PR', () => {
    expect(commentRoleTip('Author', 'ada', pr)).toBe('Author of this pull request');
  });

  it('says where a reviewer stands, matching logins case-insensitively', () => {
    expect(commentRoleTip('Reviewer', 'Bob', pr)).toBe('Requested reviewer · approved');
    expect(commentRoleTip('Reviewer', 'cy', pr)).toBe('Requested reviewer · asked for changes');
    expect(commentRoleTip('Reviewer', 'dee', pr)).toBe('Requested reviewer · not reviewed yet');
  });

  it('leaves the state out when the reviewer is not listed', () => {
    expect(commentRoleTip('Reviewer', 'eve', pr)).toBe('Requested reviewer');
  });
});
