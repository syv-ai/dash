import { describe, expect, it } from 'vitest';
import type { PrReviewer } from '../../../../shared/types';
import {
  commentRole,
  commentRoleTip,
  diffTotals,
  mergeVerb,
  prDateTime,
  reviewerGroups,
  threadsLine,
} from '../labels';

describe('diffTotals', () => {
  it('counts the files and totals their lines', () => {
    const f = (additions: number, deletions: number) => ({ additions, deletions });
    expect(diffTotals([f(3, 1), f(10, 0)])).toEqual({ files: 2, additions: 13, deletions: 1 });
    expect(diffTotals([])).toEqual({ files: 0, additions: 0, deletions: 0 });
  });
});

describe('reviewerGroups', () => {
  const r = (name: string, state: PrReviewer['state']): PrReviewer => ({ name, url: null, state });

  it('groups reviewers by where they stand, verdicts first, requests last', () => {
    const groups = reviewerGroups([
      r('dee', 'pending'),
      r('ann', 'approved'),
      r('cy', 'changes_requested'),
      r('bo', 'approved'),
      r('eve', 'commented'),
    ]);
    expect(groups.map((g) => [g.lead, g.reviewers.map((x) => x.name)])).toEqual([
      ['Approved by', ['ann', 'bo']],
      ['Changes requested by', ['cy']],
      ['Commented by', ['eve']],
      ['Review requested from', ['dee']],
    ]);
  });

  it('says nothing without reviewers', () => {
    expect(reviewerGroups([])).toEqual([]);
  });
});

describe('threadsLine', () => {
  it('says how many threads and how many are resolved', () => {
    expect(threadsLine([{ resolved: true }, { resolved: false }])).toBe(
      '2 threads (1 of 2 resolved)',
    );
    expect(threadsLine([])).toBeNull();
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
    expect(commentRoleTip('Reviewer', 'cy', pr)).toBe('Requested reviewer · changes requested');
    expect(commentRoleTip('Reviewer', 'dee', pr)).toBe('Requested reviewer · pending');
  });

  it('leaves the state out when the reviewer is not listed', () => {
    expect(commentRoleTip('Reviewer', 'eve', pr)).toBe('Requested reviewer');
  });
});
