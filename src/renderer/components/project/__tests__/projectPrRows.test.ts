import { describe, expect, it } from 'vitest';
import type { ProjectPrGroups } from '../../../../shared/projectPrs';
import type { RelevantPr } from '../../../../shared/types';
import { prListView, prRowRoute, unsupportedReason } from '../projectPrRows';

const pr = { number: 1 } as RelevantPr;
const groups: ProjectPrGroups = { waiting: [], yours: [{ pr, taskId: null }], others: [] };

describe('prListView', () => {
  it('loads until the first listing lands', () => {
    expect(prListView(undefined, null, 'r')).toEqual({ kind: 'loading' });
  });
  it('says why a forge Dash has no provider for lists nothing', () => {
    expect(prListView({ prs: null, error: null }, null, null)).toEqual({
      kind: 'unsupported',
      reason: unsupportedReason(null),
    });
    expect(unsupportedReason(null)).toMatch(/no remote/);
    expect(unsupportedReason('https://gitlab.com/a/b')).toMatch(/GitHub or Azure DevOps/);
  });
  it('fails when nothing was ever listed, and keeps what was when a relisting fails', () => {
    expect(prListView({ prs: [], error: 'gh: not logged in' }, null, 'r')).toEqual({
      kind: 'failed',
      error: 'gh: not logged in',
    });
    expect(prListView({ prs: [pr], error: 'offline' }, groups, 'r')).toEqual({
      kind: 'listed',
      groups,
      error: 'offline',
    });
  });
  it('is empty with no open PRs', () => {
    expect(prListView({ prs: [], error: null }, groups, 'r')).toEqual({ kind: 'empty' });
  });
});

describe('prRowRoute', () => {
  it('goes to the task on its head branch, else starts one', () => {
    expect(prRowRoute('t1')).toEqual({ kind: 'task', taskId: 't1' });
    expect(prRowRoute(null)).toEqual({ kind: 'start' });
  });
});
