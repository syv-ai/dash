import { describe, expect, it } from 'vitest';
import {
  firstChangedTreeFile,
  firstListedChange,
  firstTreeFile,
  onChangeCount,
  onLeavePrView,
  pickSegment,
  prViewLags,
  segmentForTarget,
  segmentOnExpand,
  segmentOnNavigate,
  viewOnSegment,
} from '../sidebarState';

describe('pickSegment', () => {
  const pick = (
    current: 'changes' | 'files' | 'history' | 'review' | 'details',
    next: 'changes' | 'files' | 'history' | 'review',
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
    expect(pick('review', 'review', false)).toBe('expand');
    expect(pick('changes', 'changes', false)).toBe('expand');
  });

  it('does nothing when a narrow Changes listing nothing is picked again', () => {
    expect(pick('changes', 'changes', false, 0, 0)).toBe('none');
  });

  it('expands on the listed changes, not the editor view’s', () => {
    // A branch view (no working count) still lists the working tree's.
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

describe('segmentForTarget', () => {
  const pr = { provider: 'github', number: 7 };

  it('falls back to Changes when the target goes away under Review', () => {
    expect(segmentForTarget('review', null)).toBe('changes');
  });

  it('keeps Review while the target loads or exists', () => {
    expect(segmentForTarget('review', undefined)).toBe('review');
    expect(segmentForTarget('review', pr)).toBe('review');
  });

  it('leaves other views alone', () => {
    expect(segmentForTarget('files', null)).toBe('files');
    expect(segmentForTarget('details', null)).toBe('details');
  });
});

describe('viewOnSegment', () => {
  type Args = Parameters<typeof viewOnSegment>[0];
  const viewOn = (args: Omit<Args, 'lastCodeSegment'> & Partial<Args>) =>
    viewOnSegment({ lastCodeSegment: 'changes', ...args });

  it('shows the PR on Review', () => {
    expect(viewOn({ from: 'changes', to: 'review', viewKind: 'working' })).toBe('pr');
  });

  it('returns to the working tree leaving Review for Changes or Files', () => {
    expect(viewOn({ from: 'review', to: 'changes', viewKind: 'pr' })).toBe('working');
    expect(viewOn({ from: 'review', to: 'files', viewKind: 'pr' })).toBe('working');
  });

  it('keeps the PR going to History, where its row stands', () => {
    expect(viewOn({ from: 'review', to: 'history', viewKind: 'pr' })).toBeNull();
  });

  it('keeps a PR opened outside Review (History’s row) on Changes', () => {
    expect(viewOn({ from: 'history', to: 'changes', viewKind: 'pr' })).toBeNull();
  });

  it('leaves Review through the details: Review → Details → Changes', () => {
    const viaDetails = { from: 'details', lastCodeSegment: 'review', viewKind: 'pr' } as const;
    expect(viewOn({ ...viaDetails, to: 'changes' })).toBe('working');
    expect(viewOn({ ...viaDetails, to: 'history' })).toBeNull();
    expect(viewOn({ ...viaDetails, lastCodeSegment: 'history', to: 'changes' })).toBeNull();
  });

  it('drops a commit view leaving History', () => {
    expect(viewOn({ from: 'history', to: 'files', viewKind: 'commit' })).toBe('working');
    expect(viewOn({ from: 'history', to: 'history', viewKind: 'commit' })).toBeNull();
  });
});

describe('prViewLags', () => {
  const pr = (number: number, head = 'h1') =>
    ({ kind: 'pr', provider: 'github', number, base: 'b', head }) as const;
  const target = { provider: 'github', number: 4 };
  const lags = (over: Partial<Parameters<typeof prViewLags>[0]> = {}) =>
    prViewLags({ segment: 'review', view: pr(4), target, review: null, ...over });

  it('follows a new target (Stop reviewing fell back to the own PR)', () => {
    expect(lags({ view: pr(9) })).toBe(true);
  });

  it("follows the refreshed review's head", () => {
    expect(lags({ review: { base: 'b', head: 'h2' } })).toBe(true);
    expect(lags({ review: { base: 'b', head: 'h1' } })).toBe(false);
    expect(lags()).toBe(false);
  });

  it('leaves other views and segments alone', () => {
    expect(lags({ segment: 'changes', view: pr(9) })).toBe(false);
    expect(lags({ view: { kind: 'working' } })).toBe(false);
    expect(lags({ target: null, view: pr(9) })).toBe(false);
  });
});

describe('segmentOnNavigate', () => {
  const target = 'pr:github:4';

  it("leaves Review for Changes for a note outside the target PR's scope", () => {
    expect(segmentOnNavigate('review', 'working', target)).toBe('changes');
    expect(segmentOnNavigate('review', 'commit:abc', target)).toBe('changes');
    expect(segmentOnNavigate('review', 'pr:github:9', target)).toBe('changes');
  });

  it("stays on Review for the target's own notes and drafts", () => {
    expect(segmentOnNavigate('review', target, target)).toBeNull();
  });

  it('leaves other views alone', () => {
    expect(segmentOnNavigate('files', 'working', target)).toBeNull();
    expect(segmentOnNavigate('history', 'commit:abc', null)).toBeNull();
  });
});

describe('onLeavePrView', () => {
  const left = { provider: 'github', number: 7 };
  it('stops reviewing the picked PR it leaves, and leaves Review for Changes', () => {
    expect(
      onLeavePrView({ left, target: { ...left, source: 'stored' }, segment: 'review' }),
    ).toEqual({ clearTarget: true, segment: 'changes' });
  });
  it("keeps the branch's own PR as the target, Review offered but not selected", () => {
    expect(onLeavePrView({ left, target: { ...left, source: 'own' }, segment: 'review' })).toEqual({
      clearTarget: false,
      segment: 'changes',
    });
  });
  it('leaves another picked PR, and a view other than Review, alone', () => {
    expect(
      onLeavePrView({
        left,
        target: { provider: 'github', number: 8, source: 'stored' },
        segment: 'files',
      }),
    ).toEqual({ clearTarget: false, segment: null });
    expect(onLeavePrView({ left, target: undefined, segment: 'history' })).toEqual({
      clearTarget: false,
      segment: null,
    });
  });
});
