import { describe, expect, it } from 'vitest';
import {
  firstChangedTreeFile,
  firstListedChange,
  firstTreeFile,
  pickSegment,
  segmentOnMode,
  viewForMode,
  viewOnExit,
  viewOnSegment,
  type CodeSegment,
} from '../sidebarState';

describe('pickSegment', () => {
  const pick = (
    current: CodeSegment | 'details',
    next: CodeSegment,
    expanded: boolean,
    {
      changesOnly = false,
      listedChanges = 3,
      openThread = true,
      reselect = true,
    }: {
      changesOnly?: boolean;
      listedChanges?: number;
      openThread?: boolean;
      reselect?: boolean;
    } = {},
  ) => pickSegment({ current, next, reselect, expanded, changesOnly, listedChanges, openThread });

  it('does nothing on a single click of the current view', () => {
    expect(pick('files', 'files', true, { reselect: false })).toBe('none');
    expect(pick('files', 'files', false, { reselect: false })).toBe('none');
  });

  it("doesn't expand on Agent, whose files open outside the task's editor", () => {
    expect(pick('agent', 'agent', false)).toBe('none');
    expect(pick('agent', 'agent', true)).toBe('narrow');
    expect(pick('files', 'agent', true)).toBe('select');
  });

  it('goes narrow when the expanded view is picked again', () => {
    expect(pick('files', 'files', true)).toBe('narrow');
    expect(pick('files', 'files', true, { changesOnly: true, listedChanges: 0 })).toBe('narrow');
  });

  it('expands when the narrow view is picked again (never collapses)', () => {
    expect(pick('files', 'files', false)).toBe('expand');
    expect(pick('files', 'files', false, { changesOnly: true })).toBe('expand');
    expect(pick('history', 'history', false)).toBe('expand');
    expect(pick('overview', 'overview', false)).toBe('expand');
    expect(pick('comments', 'comments', false)).toBe('expand');
  });

  it('does nothing when a narrow Files listing no changes is picked again', () => {
    expect(pick('files', 'files', false, { changesOnly: true, listedChanges: 0 })).toBe('none');
  });

  it('expands Files on all files whatever it lists, and History whatever is changed', () => {
    expect(pick('files', 'files', false, { listedChanges: 0 })).toBe('expand');
    expect(pick('history', 'history', false, { changesOnly: true, listedChanges: 0 })).toBe(
      'expand',
    );
  });

  it('does nothing when a narrow Comments without an open thread is picked again', () => {
    expect(pick('comments', 'comments', false, { openThread: false })).toBe('none');
    expect(pick('comments', 'comments', true, { openThread: false })).toBe('narrow');
  });

  it('shows another view without changing the state, whatever Files lists', () => {
    expect(pick('history', 'files', false)).toBe('select');
    expect(pick('files', 'history', true)).toBe('select');
    expect(pick('history', 'files', true, { changesOnly: true, listedChanges: 0 })).toBe('select');
    expect(pick('files', 'comments', true, { openThread: false })).toBe('select');
  });

  it('shows the view picked from the details', () => {
    expect(pick('details', 'files', true)).toBe('select');
    expect(pick('details', 'files', false)).toBe('select');
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

  it('orders folders by name and files by code unit, as the tree does', () => {
    expect(firstListedChange([change('Zeta/x.ts'), change('alpha/y.ts')])?.path).toBe('alpha/y.ts');
    expect(firstListedChange([change('package.json'), change('README.md')])?.path).toBe(
      'README.md',
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

describe('segmentOnMode', () => {
  const on = (segment: CodeSegment | 'details', was?: boolean, now?: boolean) =>
    segmentOnMode({ segment, was, now });

  it('shows Overview for a task found in review mode, or one entering it', () => {
    expect(on('files', undefined, true)).toBe('overview');
    expect(on('files', false, true)).toBe('overview');
    expect(on('details', false, true)).toBe('overview');
  });

  it('keeps the view while the mode holds, or before it is known', () => {
    expect(on('files', true, true)).toBe('files');
    expect(on('files', undefined, undefined)).toBe('files');
    expect(on('history', undefined, false)).toBe('history');
  });

  it('leaves Overview and Comments for Files once review mode ends; they are its alone', () => {
    expect(on('overview', true, false)).toBe('files');
    expect(on('comments', true, false)).toBe('files');
    expect(on('files', true, false)).toBe('files');
    expect(on('details', true, false)).toBe('details');
  });
});

describe('viewOnSegment', () => {
  it("leaves History's commit for the PR in review mode, the working tree otherwise", () => {
    expect(viewOnSegment({ reviewing: true, to: 'files', viewKind: 'commit' })).toBe('pr');
    expect(viewOnSegment({ reviewing: false, to: 'files', viewKind: 'commit' })).toBe('working');
  });

  it('keeps the view on History, and any view that is not a commit', () => {
    expect(viewOnSegment({ reviewing: true, to: 'history', viewKind: 'commit' })).toBeNull();
    expect(viewOnSegment({ reviewing: true, to: 'overview', viewKind: 'pr' })).toBeNull();
    expect(viewOnSegment({ reviewing: false, to: 'files', viewKind: 'working' })).toBeNull();
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

  it('applies however the mode ends, on the render it ends', () => {
    const ended = (
      view:
        | { kind: 'working' | 'commit' }
        | { kind: 'pr'; provider: string; number: number; base: string; head: string },
    ) => viewForMode({ mode: null, ended: true, view, review: null });
    expect(ended({ kind: 'commit' })).toBe('working');
    expect(ended({ kind: 'pr', provider: 'github', number: 4, base: 'b1', head: 'h1' })).toBe(
      'working',
    );
    expect(ended({ kind: 'working' })).toBeNull();
  });
});
