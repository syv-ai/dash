import { describe, it, expect } from 'vitest';
import type { PullRequestInfo } from '../../../shared/types';
import { prOutcomes } from '../prOutcomes';

const pr = (
  number: number,
  state: PullRequestInfo['state'],
  provider: 'github' | 'ado' = 'github',
) => ({ number, title: 't', url: 'u', state, provider }) as PullRequestInfo;

describe('prOutcomes', () => {
  it('stays quiet the first time a branch is listed: its PRs may be old', () => {
    const r = prOutcomes({}, { 'a@feat': [pr(3, 'open'), pr(2, 'merged')] });
    expect(r.opened).toEqual([]);
    expect(r.merged).toEqual([]);
    expect(r.next).toEqual({ 'a@feat': { 3: 'open', 2: 'merged' } });
  });

  it('reports a PR new to a branch already listed, even one listed empty', () => {
    const r = prOutcomes({ 'a@feat': {} }, { 'a@feat': [pr(7, 'open', 'ado')] });
    expect(r.opened).toEqual([pr(7, 'open', 'ado')]);
    expect(r.merged).toEqual([]);
  });

  it('reports a merge once, when a PR seen open turns merged', () => {
    const seen = { 'a@feat': { 7: 'open' as const } };
    const r = prOutcomes(seen, { 'a@feat': [pr(7, 'merged')] });
    expect(r.opened).toEqual([]);
    expect(r.merged).toEqual([pr(7, 'merged')]);
    expect(prOutcomes(r.next, { 'a@feat': [pr(7, 'merged')] }).merged).toEqual([]);
  });

  it('reports both for a PR opened and merged between two looks', () => {
    const r = prOutcomes({ 'a@feat': {} }, { 'a@feat': [pr(9, 'merged')] });
    expect(r.opened).toEqual([pr(9, 'merged')]);
    expect(r.merged).toEqual([pr(9, 'merged')]);
  });

  it('remembers PRs that drop out of a listing, so they do not count again', () => {
    const r = prOutcomes({ 'a@feat': { 4: 'open' } }, { 'a@feat': [] });
    expect(r.next).toEqual({ 'a@feat': { 4: 'open' } });
    expect(prOutcomes(r.next, { 'a@feat': [pr(4, 'open')] }).opened).toEqual([]);
  });
});
