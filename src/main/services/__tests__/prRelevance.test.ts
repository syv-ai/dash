import { describe, it, expect } from 'vitest';
import type { PullRequestInfo } from '@shared/types';
import { ciFromRollup, relevantPrs } from '../prRelevance';

const pr = (
  number: number,
  state: PullRequestInfo['state'],
  headSha?: string,
): PullRequestInfo => ({
  number,
  title: `#${number}`,
  url: `u/${number}`,
  state,
  provider: 'github',
  headSha,
});
const never = async () => false;
const always = async () => true;

describe('relevantPrs', () => {
  it('shows every open PR, newest first, and hides older merged ones', async () => {
    const prs = [pr(3, 'open'), pr(1, 'merged'), pr(7, 'open')];
    expect((await relevantPrs(prs, always)).map((p) => p.number)).toEqual([7, 3]);
  });

  it('keeps a merged PR while the branch has not moved past it', async () => {
    expect(await relevantPrs([pr(4, 'merged', 'abc')], never)).toEqual([pr(4, 'merged', 'abc')]);
  });

  it('drops a merged or closed PR once the branch has new commits on top of it', async () => {
    expect(await relevantPrs([pr(4, 'merged', 'abc')], always)).toEqual([]);
    expect(await relevantPrs([pr(5, 'closed', 'def')], always)).toEqual([]);
  });

  it('judges only the newest finished PR', async () => {
    const seen: string[] = [];
    const movedPast = async (sha: string) => (seen.push(sha), false);
    const r = await relevantPrs([pr(2, 'merged', 'old'), pr(6, 'closed', 'new')], movedPast);
    expect(r.map((p) => p.number)).toEqual([6]);
    expect(seen).toEqual(['new']);
  });

  it('keeps a finished PR whose head commit is unknown', async () => {
    expect((await relevantPrs([pr(4, 'merged')], always)).map((p) => p.number)).toEqual([4]);
  });

  it('is empty without PRs', async () => {
    expect(await relevantPrs([], always)).toEqual([]);
  });
});

describe('ciFromRollup', () => {
  const run = (status: string, conclusion: string | null = null) => ({
    __typename: 'CheckRun',
    status,
    conclusion,
  });
  const ctx = (state: string) => ({ __typename: 'StatusContext', state });

  it('is null without checks', () => {
    expect(ciFromRollup([])).toBeNull();
    expect(ciFromRollup(undefined)).toBeNull();
  });

  it('fails on any failed check, even with others still running', () => {
    expect(ciFromRollup([run('IN_PROGRESS'), run('COMPLETED', 'FAILURE')])).toBe('failing');
    expect(ciFromRollup([ctx('ERROR')])).toBe('failing');
  });

  it('is pending while a check runs or a status is expected', () => {
    expect(ciFromRollup([run('COMPLETED', 'SUCCESS'), run('QUEUED')])).toBe('pending');
    expect(ciFromRollup([ctx('PENDING')])).toBe('pending');
  });

  it('passes when everything finished without failing, skipped checks included', () => {
    expect(ciFromRollup([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED')])).toBe(
      'passing',
    );
    expect(ciFromRollup([ctx('SUCCESS')])).toBe('passing');
  });
});
