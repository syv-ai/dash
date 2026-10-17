import { describe, it, expect } from 'vitest';
import type { PullRequestInfo } from '@shared/types';
import { ciFromAdo, ciFromRollup, relevantPrs } from '../prRelevance';

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
  const current = (prs: PullRequestInfo[]) => prs.filter((p) => p.current).map((p) => p.number);
  const all = (prs: PullRequestInfo[]) => prs.map((p) => p.number);

  it('lists every PR on the branch newest first, with every open one current', async () => {
    const r = await relevantPrs([pr(3, 'open'), pr(1, 'merged'), pr(7, 'open')], always);
    expect(all(r)).toEqual([7, 3, 1]);
    expect(current(r)).toEqual([7, 3]);
  });

  it('keeps a merged PR current while the branch has not moved past it', async () => {
    expect(current(await relevantPrs([pr(4, 'merged', 'abc')], never))).toEqual([4]);
  });

  it('keeps a merged or closed PR in the list, not current, once the branch has new commits', async () => {
    const r = await relevantPrs([pr(4, 'merged', 'abc'), pr(5, 'closed', 'def')], always);
    expect(all(r)).toEqual([5, 4]);
    expect(current(r)).toEqual([]);
  });

  it('judges only the newest finished PR', async () => {
    const seen: string[] = [];
    const movedPast = async (sha: string) => (seen.push(sha), false);
    const r = await relevantPrs([pr(2, 'merged', 'old'), pr(6, 'closed', 'new')], movedPast);
    expect(current(r)).toEqual([6]);
    expect(seen).toEqual(['new']);
  });

  it('keeps a finished PR whose head commit is unknown current', async () => {
    expect(current(await relevantPrs([pr(4, 'merged')], always))).toEqual([4]);
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

describe('ciFromAdo', () => {
  const BUILD = '0609b952-1397-4640-95ec-e00a01b2c241';
  const STATUS = 'cbdc66da-9728-4af8-aada-9a5a32e4a226';
  const REVIEWERS = 'fa4e907d-c16b-4a4c-9dfa-4906e5d171dd';
  const policy = (status: string, type = BUILD) => ({
    status,
    configuration: { type: { id: type } },
  });
  const st = (id: number, state: string, name = 'ci', genre = 'ext') => ({
    id,
    state,
    context: { name, genre },
  });

  it('is null without build or status checks', () => {
    expect(ciFromAdo([], [])).toBeNull();
    expect(ciFromAdo(null, undefined)).toBeNull();
    expect(ciFromAdo([policy('rejected', REVIEWERS)], [st(1, 'notSet')])).toBeNull();
  });

  it('fails on a rejected or broken build or status policy, or a failed status', () => {
    expect(ciFromAdo([policy('approved'), policy('rejected')], [])).toBe('failing');
    expect(ciFromAdo([policy('broken', STATUS)], [])).toBe('failing');
    expect(ciFromAdo([policy('running')], [st(1, 'error')])).toBe('failing');
  });

  it('is pending while a check is queued or running, passing once all succeed', () => {
    expect(ciFromAdo([policy('queued')], [])).toBe('pending');
    expect(ciFromAdo([policy('approved')], [st(1, 'pending')])).toBe('pending');
    expect(ciFromAdo([policy('approved'), policy('notApplicable')], [st(1, 'succeeded')])).toBe(
      'passing',
    );
  });

  it('ignores reviewer and other non-CI policies', () => {
    expect(ciFromAdo([policy('approved'), policy('rejected', REVIEWERS)], [])).toBe('passing');
  });

  it('uses the latest status per context', () => {
    expect(ciFromAdo([], [st(1, 'failed'), st(2, 'succeeded')])).toBe('passing');
    expect(ciFromAdo([], [st(2, 'succeeded'), st(1, 'failed'), st(3, 'failed', 'lint')])).toBe(
      'failing',
    );
  });
});
