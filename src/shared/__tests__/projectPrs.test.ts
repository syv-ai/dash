import { describe, it, expect } from 'vitest';
import type { PrViewerInvolvement, RelevantPr } from '../types';
import { groupProjectPrs, prGroupOf, taskForPr } from '../projectPrs';

const you = (over: Partial<PrViewerInvolvement> = {}): PrViewerInvolvement => ({
  isAuthor: false,
  isAssignee: false,
  isRequestedReviewer: false,
  ...over,
});
const pr = (
  number: number,
  viewer: PrViewerInvolvement | null,
  headRefName = `b${number}`,
  fromFork = false,
) => ({ number, viewer, headRefName, fromFork }) as RelevantPr;
const task = (id: string, branch: string, archivedAt: string | null = null) => ({
  id,
  branch,
  archivedAt,
});

describe('prGroupOf', () => {
  it('waits on you when you are asked to review, or assigned to what is not yours', () => {
    expect(prGroupOf(you({ isRequestedReviewer: true }))).toBe('waiting');
    expect(prGroupOf(you({ isAssignee: true }))).toBe('waiting');
  });

  it('counts your own PR as yours, assigned to you or not', () => {
    expect(prGroupOf(you({ isAuthor: true }))).toBe('yours');
    expect(prGroupOf(you({ isAuthor: true, isAssignee: true }))).toBe('yours');
  });

  it('waits on you to review even your own PR when asked by name', () => {
    expect(prGroupOf(you({ isAuthor: true, isRequestedReviewer: true }))).toBe('waiting');
  });

  it("puts the rest, and a PR whose forge can't say who you are, with everyone else", () => {
    expect(prGroupOf(you())).toBe('others');
    expect(prGroupOf(null)).toBe('others');
  });
});

describe('taskForPr', () => {
  it('finds the task on its head branch, a live one before an archived one', () => {
    const tasks = [task('old', 'feat', '2026-11-01'), task('live', 'feat'), task('x', 'main')];
    expect(taskForPr(pr(1, null, 'feat'), tasks)).toBe('live');
    expect(taskForPr(pr(1, null, 'feat'), [task('old', 'feat', '2026-11-01')])).toBe('old');
  });

  it("finds a fork PR's task on pr/<n>/<head>, never one on a same-named branch", () => {
    expect(taskForPr(pr(1, null, 'feat', true), [task('t', 'feat')])).toBeNull();
    expect(taskForPr(pr(1, null, 'feat', true), [task('t', 'pr/1/feat')])).toBe('t');
  });

  it('has none when no task is on its head', () => {
    expect(taskForPr(pr(1, null, 'feat'), [task('t', 'feature')])).toBeNull();
    expect(taskForPr(pr(1, null, ''), [task('t', '')])).toBeNull();
  });
});

describe('groupProjectPrs', () => {
  it('groups the PRs in their listed order, each with its task', () => {
    const groups = groupProjectPrs(
      [
        pr(9, you({ isRequestedReviewer: true })),
        pr(8, you({ isAuthor: true }), 'mine'),
        pr(7, null),
        pr(6, you({ isAssignee: true })),
      ],
      [task('t-mine', 'mine')],
    );
    expect(groups.waiting.map((p) => p.pr.number)).toEqual([9, 6]);
    expect(groups.yours).toEqual([
      { pr: expect.objectContaining({ number: 8 }), taskId: 't-mine' },
    ]);
    expect(groups.others.map((p) => [p.pr.number, p.taskId])).toEqual([[7, null]]);
  });

  it('is three empty groups for no PRs', () => {
    expect(groupProjectPrs([], [])).toEqual({ waiting: [], yours: [], others: [] });
  });
});
