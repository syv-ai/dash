import { describe, it, expect } from 'vitest';
import type { PullRequestInfo } from '../../../shared/types';
import { newlyMergedPrs } from '../mergedPrNotices';

const pr = (number: number, state: PullRequestInfo['state']): PullRequestInfo => ({
  number,
  title: 't',
  url: 'u',
  state,
  provider: 'github',
});
const ids = (...t: string[]) => new Set(t);
const none = () => false;

describe('newlyMergedPrs', () => {
  it('offers a task whose PR went from open to merged', () => {
    const r = newlyMergedPrs({ a: '12:open' }, { a: pr(12, 'merged') }, ids('a'), none);
    expect(r.merged).toEqual(['a']);
    expect(r.next).toEqual({ a: '12:merged' });
  });

  it('stays quiet for a PR already merged the first time it is seen', () => {
    const r = newlyMergedPrs({}, { a: pr(12, 'merged') }, ids('a'), none);
    expect(r.merged).toEqual([]);
    expect(r.next).toEqual({ a: '12:merged' });
  });

  it('offers it only once', () => {
    const r = newlyMergedPrs({ a: '12:merged' }, { a: pr(12, 'merged') }, ids('a'), none);
    expect(r.merged).toEqual([]);
  });

  it('skips archived tasks but still records the state', () => {
    const r = newlyMergedPrs({ a: '12:open' }, { a: pr(12, 'merged') }, ids('a'), () => true);
    expect(r.merged).toEqual([]);
    expect(r.next).toEqual({ a: '12:merged' });
  });

  it('keeps what was seen when a fetch comes back empty', () => {
    const r = newlyMergedPrs({ a: '12:open' }, { a: null }, ids('a'), none);
    expect(r.merged).toEqual([]);
    expect(r.next).toEqual({ a: '12:open' });
  });

  it('records but does not offer a task it does not know yet, nor forgets one', () => {
    const r = newlyMergedPrs({ b: '3:open' }, { a: pr(12, 'open') }, ids(), none);
    expect(r.merged).toEqual([]);
    expect(r.next).toEqual({ a: '12:open', b: '3:open' });
  });

  it("offers a later PR's merge after an earlier PR on the task was closed", () => {
    const r = newlyMergedPrs({ a: '12:closed' }, { a: pr(13, 'merged') }, ids('a'), none);
    expect(r.merged).toEqual(['a']);
  });
});
