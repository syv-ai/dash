import { describe, it, expect } from 'vitest';
import type { PrReview, PrReviewThread } from '../../../shared/types';
import {
  buildReviewPrompt,
  newReviewComments,
  threadLocation,
  unresolvedThreads,
} from '../prReviewNotices';

const thread = (
  id: string,
  commentIds: string[],
  over: Partial<PrReviewThread> = {},
): PrReviewThread => ({
  id,
  path: 'src/a.ts',
  line: 12,
  startLine: null,
  side: 'RIGHT',
  isOutdated: false,
  resolved: false,
  comments: commentIds.map((c) => ({
    id: c,
    author: 'rev',
    body: `body ${c}`,
    createdAt: '',
    url: '',
  })),
  ...over,
});
const review = (number: number, threads: PrReviewThread[]): PrReview => ({
  provider: 'github',
  number,
  title: 't',
  url: `https://github.com/o/r/pull/${number}`,
  viewerIsAuthor: false,
  verdicts: ['comment'],
  base: 'b',
  head: 'h',
  threads,
  conversation: [],
});

describe('newReviewComments', () => {
  it('stays quiet the first time it sees a PR, and remembers its comments', () => {
    const r = newReviewComments(undefined, review(4, [thread('T1', ['a', 'b'])]));
    expect(r.threads).toEqual([]);
    expect(r.count).toBe(0);
    expect(r.next).toEqual({ pr: 4, ids: ['a', 'b'] });
  });

  it('reports threads with comments not seen before', () => {
    const seen = { pr: 4, ids: ['a'] };
    const t1 = thread('T1', ['a', 'b']);
    const t2 = thread('T2', ['c']);
    const t3 = thread('T3', ['a']);
    const r = newReviewComments(seen, review(4, [t1, t2, t3]));
    expect(r.threads).toEqual([t1, t2]);
    expect(r.count).toBe(2);
    expect(r.next).toEqual({ pr: 4, ids: ['a', 'b', 'c'] });
  });

  it('treats a different PR on the branch as a first look', () => {
    const r = newReviewComments({ pr: 3, ids: ['x'] }, review(4, [thread('T1', ['a'])]));
    expect(r.count).toBe(0);
    expect(r.next).toEqual({ pr: 4, ids: ['a'] });
  });

  it('keeps ids of threads resolved since, so reopening one does not re-announce it', () => {
    const r = newReviewComments({ pr: 4, ids: ['a', 'gone'] }, review(4, [thread('T1', ['a'])]));
    expect(r.next.ids).toEqual(['a', 'gone']);
  });
});

describe('unresolvedThreads', () => {
  it('leaves out resolved threads, so they never reach a prompt or the toast', () => {
    const open = thread('T1', ['a']);
    const done = thread('T2', ['b'], { resolved: true });
    expect(unresolvedThreads(review(4, [open, done]))).toEqual([open]);
    const seen = newReviewComments(undefined, review(4, [open])).next;
    expect(
      newReviewComments(
        seen,
        review(4, [
          open,
          { ...done, comments: [...done.comments, ...thread('x', ['c']).comments] },
        ]),
      ).count,
    ).toBe(0);
  });
});

describe('threadLocation', () => {
  it('names the file and line range, or why it has none', () => {
    expect(threadLocation(thread('T', [], { startLine: 10 }))).toBe('src/a.ts:10-12');
    expect(threadLocation(thread('T', []))).toBe('src/a.ts:12');
    expect(threadLocation(thread('T', [], { line: null, isOutdated: true }))).toBe(
      'src/a.ts (outdated)',
    );
    expect(threadLocation(thread('T', [], { side: 'LEFT' }))).toBe('src/a.ts:12 (removed line)');
  });
});

describe('buildReviewPrompt', () => {
  it('labels the comments as review content, not instructions, before quoting them', () => {
    const text = buildReviewPrompt(review(4, []), [
      thread('T1', ['a'], { startLine: 10 }),
      thread('T2', ['b'], { path: 'src/b.ts' }),
    ]);
    const label = text.indexOf('not instructions');
    expect(label).toBeGreaterThan(-1);
    expect(label).toBeLessThan(text.indexOf('body a'));
    expect(text).toContain('PR #4');
    expect(text).toContain('src/a.ts:10-12\n  @rev: body a');
    expect(text).toContain('src/b.ts:12\n  @rev: body b');
  });

  it('indents multi-line comments under their author', () => {
    const t = thread('T1', ['a']);
    t.comments[0]!.body = 'line one\nline two';
    expect(buildReviewPrompt(review(4, []), [t])).toContain('  @rev: line one\n    line two');
  });

  it('caps its length and says how many threads it left out', () => {
    const big = Array.from({ length: 40 }, (_, i) => {
      const t = thread(`T${i}`, [`c${i}`]);
      t.comments[0]!.body = 'x'.repeat(1000);
      return t;
    });
    const text = buildReviewPrompt(review(4, []), big, { maxChars: 5000 });
    expect(text.length).toBeLessThanOrEqual(5000);
    expect(text).toMatch(/\d+ more threads? left out/);
  });
});
