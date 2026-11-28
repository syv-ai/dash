import { describe, expect, it } from 'vitest';
import type { ProjectPrGroups } from '../../../../shared/projectPrs';
import type { RelevantPr } from '../../../../shared/types';
import { prListView, prRowFacts, prRowRoute, unsupportedReason } from '../projectPrRows';

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

describe('prRowFacts', () => {
  const now = Date.parse('2026-11-28T12:00:00Z') / 1000;
  it('counts open threads and says how long since it moved', () => {
    const facts = prRowFacts(
      { threads: { open: 2, total: 5 }, updatedAt: '2026-11-28T10:00:00Z' },
      now,
    );
    expect(facts.openThreads).toBe(2);
    expect(facts.threadsTitle).toBe('2 unresolved of 5 threads');
    expect(facts.updated).toBe('2h');
    expect(facts.updatedTitle).toMatch(/^Updated /);
  });
  it("leaves out what the forge's listing doesn't carry (ADO)", () => {
    expect(prRowFacts({ threads: null, updatedAt: null }, now)).toEqual({
      openThreads: null,
      threadsTitle: null,
      updated: '',
      updatedTitle: null,
    });
  });
});

describe('prRowRoute', () => {
  it('goes to the task on its head branch, else starts one', () => {
    expect(prRowRoute('t1')).toEqual({ kind: 'task', taskId: 't1' });
    expect(prRowRoute(null)).toEqual({ kind: 'start' });
  });
});
