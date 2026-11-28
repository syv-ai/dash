import { describe, it, expect } from 'vitest';
import type { FileChange, GitStatus } from '../../../../shared/types';
import { railParts, RAIL_SHOW } from '../rail';

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
  it('shows no git parts before the git status has loaded', () => {
    expect(railParts(null)).toEqual({ sync: null, changes: null });
  });

  it('shows ahead/behind only once the branch and its upstream have moved apart', () => {
    expect(railParts(status()).sync).toBeNull();
    expect(railParts(status({ ahead: 3 })).sync).toEqual({
      ahead: 3,
      behind: 0,
    });
    expect(railParts(status({ ahead: 2, behind: 1 })).sync).toEqual({
      ahead: 2,
      behind: 1,
    });
  });

  it('has no ahead/behind without an upstream', () => {
    const noUpstream = status({ hasUpstream: false, ahead: 4 });
    expect(railParts(noUpstream).sync).toBeNull();
  });

  it("counts the changed files as Files' tab does, staged or not, and hides a zero", () => {
    expect(railParts(status()).changes).toBeNull();
    const files = [file('a.ts'), file('b.ts', true), file('a.ts', true)];
    expect(railParts(status({ files })).changes).toBe(3);
  });
});

describe('RAIL_SHOW', () => {
  it('shows the changes on Files, ahead/behind on History, the PRs on PRs and Details on Details', () => {
    expect(RAIL_SHOW.changes).toEqual({ view: 'files', terminal: false });
    expect(RAIL_SHOW.sync).toEqual({ view: 'history', terminal: false });
    expect(RAIL_SHOW.pr).toEqual({ view: 'prs', terminal: false });
    expect(RAIL_SHOW.details).toEqual({ view: 'details', terminal: false });
  });

  it('leaves the view be for its space', () => {
    expect(RAIL_SHOW.space).toEqual({ view: null, terminal: false });
  });

  it('opens the terminal only from its own button, on the view the sidebar has', () => {
    expect(RAIL_SHOW.terminal).toEqual({ view: null, terminal: true });
    const others = Object.entries(RAIL_SHOW).filter(([target]) => target !== 'terminal');
    expect(others.every(([, show]) => !show.terminal)).toBe(true);
  });
});
