import { describe, it, expect } from 'vitest';
import type { FileChange, GitStatus } from '../../../../shared/types';
import { railParts, RAIL_VIEW } from '../rail';

const file = (path: string, staged = false): FileChange => ({
  path,
  status: 'modified',
  staged,
  additions: 1,
  deletions: 0,
});

const status = (over: Partial<GitStatus> = {}) => ({
  hasUpstream: true,
  ahead: 0,
  behind: 0,
  files: [],
  ...over,
});

describe('railParts', () => {
  it('shows only the limits before the git status has loaded', () => {
    expect(railParts({ limitsShown: true, status: null })).toEqual({
      limits: true,
      sync: null,
      changes: null,
    });
  });

  it('leaves the limits out where the sidebar does', () => {
    expect(railParts({ limitsShown: false, status: status() }).limits).toBe(false);
  });

  it('shows ahead/behind only once the branch and its upstream have moved apart', () => {
    expect(railParts({ limitsShown: true, status: status() }).sync).toBeNull();
    expect(railParts({ limitsShown: true, status: status({ ahead: 3 }) }).sync).toEqual({
      ahead: 3,
      behind: 0,
    });
    expect(railParts({ limitsShown: true, status: status({ ahead: 2, behind: 1 }) }).sync).toEqual({
      ahead: 2,
      behind: 1,
    });
  });

  it('has no ahead/behind without an upstream', () => {
    const noUpstream = status({ hasUpstream: false, ahead: 4 });
    expect(railParts({ limitsShown: true, status: noUpstream }).sync).toBeNull();
  });

  it("counts the changed files as Files' tab does, staged or not, and hides a zero", () => {
    expect(railParts({ limitsShown: true, status: status() }).changes).toBeNull();
    const files = [file('a.ts'), file('b.ts', true), file('a.ts', true)];
    expect(railParts({ limitsShown: true, status: status({ files }) }).changes).toBe(3);
  });
});

describe('RAIL_VIEW', () => {
  it('opens the changes on Files and ahead/behind on History; its space leaves the view be', () => {
    expect(RAIL_VIEW).toEqual({ changes: 'files', sync: 'history', space: null });
  });
});
