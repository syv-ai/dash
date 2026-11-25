import { describe, expect, it } from 'vitest';
import {
  firstChangedTreeFile,
  firstListedChange,
  firstTreeFile,
  onChangeCount,
  pickSegment,
  segmentForMode,
  segmentOnExpand,
  viewForMode,
  viewOnExit,
  viewOnSegment,
} from '../sidebarState';

describe('pickSegment', () => {
  const pick = (
    current: 'overview' | 'changes' | 'files' | 'history' | 'details',
    next: 'overview' | 'changes' | 'files' | 'history',
    expanded: boolean,
    changeCount: number | null = 3,
    listedChanges = 3,
  ) => pickSegment({ current, next, expanded, changeCount, listedChanges });

  it('goes narrow when the expanded view is picked again', () => {
    expect(pick('files', 'files', true)).toBe('narrow');
    expect(pick('changes', 'changes', true)).toBe('narrow');
  });

  it('expands when the narrow view is picked again (never collapses)', () => {
    expect(pick('files', 'files', false)).toBe('expand');
    expect(pick('history', 'history', false)).toBe('expand');
    expect(pick('overview', 'overview', false)).toBe('expand');
    expect(pick('changes', 'changes', false)).toBe('expand');
  });

  it('does nothing when a narrow Changes listing nothing is picked again', () => {
    expect(pick('changes', 'changes', false, 0, 0)).toBe('none');
  });

  it('expands on the listed changes, not the editor view’s', () => {
    // A PR view (no working count) lists what Changes shows (review mode: the PR's).
    expect(pick('changes', 'changes', false, null, 2)).toBe('expand');
  });

  it('expands Files and History whatever Changes lists', () => {
    expect(pick('files', 'files', false, 0, 0)).toBe('expand');
    expect(pick('history', 'history', false, 0, 0)).toBe('expand');
  });

  it('shows another view without changing the state', () => {
    expect(pick('changes', 'files', false)).toBe('select');
    expect(pick('files', 'history', true)).toBe('select');
    expect(pick('files', 'changes', true)).toBe('select');
  });

  it('shows the view picked from the details', () => {
    expect(pick('details', 'files', true)).toBe('select');
    expect(pick('details', 'files', false)).toBe('select');
  });

  it('goes narrow to an empty Changes', () => {
    expect(pick('files', 'changes', true, 0)).toBe('narrow');
    expect(pick('files', 'changes', false, 0)).toBe('select');
  });

  it('keeps Changes expanded while the status loads', () => {
    expect(pick('files', 'changes', true, null)).toBe('select');
  });
});

describe('firstListedChange', () => {
  const change = (path: string, staged = false) => ({ path, staged });

  it('lists staged changes first', () => {
    expect(firstListedChange([change('a.ts'), change('z.ts', true)])?.path).toBe('z.ts');
  });

  it('puts a folder ahead of the files beside it, depth first', () => {
    expect(
      firstListedChange([change('README.md'), change('src/b/c.ts'), change('src/a.ts')])?.path,
    ).toBe('src/b/c.ts');
  });

  it('orders folders and files by name, as the list does', () => {
    expect(firstListedChange([change('Zeta/x.ts'), change('alpha/y.ts')])?.path).toBe('alpha/y.ts');
    expect(firstListedChange([change('package.json'), change('README.md')])?.path).toBe(
      'package.json',
    );
  });

  it('is null with nothing changed', () => {
    expect(firstListedChange([])).toBeNull();
  });
});

describe('firstTreeFile', () => {
  it('takes the first file at the shallowest level, folders folded', () => {
    expect(firstTreeFile(['src/a.ts', 'docs/x.md', 'package.json', 'README.md'])).toBe('README.md');
  });

  it('goes a level down when the root holds only folders', () => {
    expect(firstTreeFile(['src/z.ts', 'docs/x.md', 'src/deep/a.ts'])).toBe('docs/x.md');
  });

  it('is null for an empty repo', () => {
    expect(firstTreeFile([])).toBeNull();
  });
});

describe('firstChangedTreeFile', () => {
  it('takes the tree’s first file with its folders unfolded', () => {
    expect(firstChangedTreeFile(['README.md', 'src/b.ts', 'src/a/c.ts'])).toBe('src/a/c.ts');
  });

  it('is null with no files', () => {
    expect(firstChangedTreeFile([])).toBeNull();
  });
});

describe('onChangeCount', () => {
  const base = { segment: 'changes' as const, expanded: true };

  it('narrows when Changes empties while it shows expanded', () => {
    expect(onChangeCount({ ...base, before: 2, now: 0 })).toBe('narrow');
  });

  it('shows Files when the status loads empty (a task switched back to)', () => {
    expect(onChangeCount({ ...base, before: null, now: 0 })).toBe('files');
  });

  it('reacts to the change only, not to it staying empty', () => {
    expect(onChangeCount({ ...base, before: 0, now: 0 })).toBeNull();
  });

  it('never expands again as changes appear', () => {
    expect(onChangeCount({ ...base, before: 0, now: 2 })).toBeNull();
  });

  it('leaves the other views and a narrow sidebar alone', () => {
    expect(onChangeCount({ ...base, segment: 'files', before: 2, now: 0 })).toBeNull();
    expect(onChangeCount({ ...base, expanded: false, before: 2, now: 0 })).toBeNull();
  });
});

describe('segmentOnExpand', () => {
  it('shows Files when a file opens on an empty Changes', () => {
    expect(segmentOnExpand('changes', 0)).toBe('files');
  });

  it('keeps Changes with changes to show, and any other view', () => {
    expect(segmentOnExpand('changes', 2)).toBe('changes');
    expect(segmentOnExpand('changes', null)).toBe('changes');
    expect(segmentOnExpand('history', 0)).toBe('history');
    expect(segmentOnExpand('details', 0)).toBe('details');
  });
});

describe('segmentForMode', () => {
  it("leaves Overview for Changes once review mode ends; it is review mode's alone", () => {
    expect(segmentForMode('overview', false)).toBe('changes');
    expect(segmentForMode('overview', true)).toBe('overview');
    expect(segmentForMode('files', false)).toBe('files');
    expect(segmentForMode('details', false)).toBe('details');
  });
});

describe('viewOnSegment', () => {
  it("leaves History's commit for the PR in review mode, the working tree otherwise", () => {
    expect(viewOnSegment({ reviewing: true, to: 'changes', viewKind: 'commit' })).toBe('pr');
    expect(viewOnSegment({ reviewing: false, to: 'files', viewKind: 'commit' })).toBe('working');
  });

  it('keeps the view on History, and any view that is not a commit', () => {
    expect(viewOnSegment({ reviewing: true, to: 'history', viewKind: 'commit' })).toBeNull();
    expect(viewOnSegment({ reviewing: true, to: 'overview', viewKind: 'pr' })).toBeNull();
    expect(viewOnSegment({ reviewing: false, to: 'changes', viewKind: 'working' })).toBeNull();
  });
});

describe('viewForMode', () => {
  const pr = (number: number, head = 'h1') =>
    ({ kind: 'pr', provider: 'github', number, base: 'b1', head }) as const;
  const mode = { provider: 'github', number: 4 };

  it("shows the mode's PR in place of the working tree or another PR", () => {
    expect(viewForMode({ mode, view: { kind: 'working' }, review: null })).toBe('pr');
    expect(viewForMode({ mode, view: pr(7), review: null })).toBe('pr');
  });

  it('follows the head its review was reloaded at (a push)', () => {
    expect(viewForMode({ mode, view: pr(4), review: { base: 'b1', head: 'h2' } })).toBe('pr');
    expect(viewForMode({ mode, view: pr(4), review: { base: 'b1', head: 'h1' } })).toBeNull();
    expect(viewForMode({ mode, view: pr(4), review: null })).toBeNull();
  });

  it('leaves a commit picked in History', () => {
    expect(viewForMode({ mode, view: { kind: 'commit' }, review: null })).toBeNull();
  });

  it("returns a PR's view to the working tree out of review mode", () => {
    expect(viewForMode({ mode: null, view: pr(4), review: null })).toBe('working');
    expect(viewForMode({ mode: null, view: { kind: 'commit' }, review: null })).toBeNull();
    expect(viewForMode({ mode: null, view: { kind: 'working' }, review: null })).toBeNull();
  });
});

describe('viewOnExit', () => {
  it('returns to the working tree from the PR and from a PR commit', () => {
    expect(viewOnExit('pr')).toBe('working');
    expect(viewOnExit('commit')).toBe('working');
    expect(viewOnExit('working')).toBeNull();
  });
});
