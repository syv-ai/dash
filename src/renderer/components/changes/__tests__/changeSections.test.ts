import { describe, expect, it } from 'vitest';
import {
  changeSections,
  changeSelection,
  fileActions,
  folderActions,
  oneChangePerPath,
  stagedState,
  sectionOfView,
  viewOfSection,
} from '../changeSections';
import { buildTree } from '../../fileTree/model';
import type { FileChange, FileChangeStatus } from '../../../../shared/types';

const f = (path: string, status: FileChangeStatus = 'modified', staged = false): FileChange => ({
  path,
  status,
  staged,
  additions: 1,
  deletions: 0,
});

describe('changeSections', () => {
  it('lists staged changes, then unstaged ones, each headed with its count', () => {
    const sections = changeSections([f('a.ts'), f('b.ts', 'added', true), f('c.ts')]);
    expect(sections.map((s) => [s.id, s.label, s.tree.tally.changed])).toEqual([
      ['staged', 'Staged · 1', 1],
      ['unstaged', 'Unstaged · 2', 2],
    ]);
  });

  it('leaves an empty section out', () => {
    expect(changeSections([f('a.ts')]).map((s) => s.id)).toEqual(['unstaged']);
    expect(changeSections([])).toEqual([]);
  });

  it('lists a partly staged file in both', () => {
    const sections = changeSections([f('a.ts', 'modified', true), f('a.ts')]);
    expect(sections.map((s) => s.tree.files[0]!.change!.staged)).toEqual([true, false]);
  });
});

describe('changeSelection', () => {
  const files = [f('both.ts', 'modified', true), f('both.ts'), f('only-staged.ts', 'added', true)];
  const staged = { kind: 'working', ref: 'index' } as const;
  const working = { kind: 'working', ref: 'HEAD' } as const;

  it('selects the row in the section the editor’s view shows', () => {
    expect(changeSelection('both.ts', staged, files)).toEqual({
      path: 'both.ts',
      section: 'staged',
    });
    expect(changeSelection('both.ts', working, files)?.section).toBe('unstaged');
  });

  it('falls back to wherever the file is listed', () => {
    expect(changeSelection('only-staged.ts', working, files)?.section).toBe('staged');
  });

  it('selects nothing for a file Changes doesn’t list', () => {
    expect(changeSelection('other.ts', working, files)).toBeNull();
    expect(changeSelection(null, working, files)).toBeNull();
  });
});

describe('views', () => {
  it('opens the staged diff in the index view, the rest in the working tree’s', () => {
    expect(viewOfSection('staged')).toEqual({ kind: 'working', ref: 'index' });
    expect(viewOfSection('unstaged')).toEqual({ kind: 'working', ref: 'HEAD' });
    expect(sectionOfView(viewOfSection('staged'))).toBe('staged');
    expect(sectionOfView({ kind: 'commit', hash: 'x' })).toBeNull();
  });
});

describe('row actions', () => {
  it('discards a folder’s unstaged changes, never a deletion', () => {
    const tree = buildTree([f('d/a.ts'), f('d/gone.ts', 'deleted'), f('d/x/b.ts', 'untracked')]);
    expect(folderActions(tree.folders.get('d')!)).toEqual({
      discardable: ['d/a.ts', 'd/x/b.ts'],
      canIgnore: false,
    });
  });

  it('.gitignores a folder only when everything in it is untracked', () => {
    const tree = buildTree([f('v/a.js', 'untracked'), f('v/b/c.js', 'untracked')]);
    expect(folderActions(tree.folders.get('v')!).canIgnore).toBe(true);
  });

  it('discards an unstaged file, .gitignores an untracked one', () => {
    expect(fileActions(f('a.ts'))).toEqual({ canDiscard: true, canIgnore: false });
    expect(fileActions(f('a.ts', 'modified', true))).toEqual({
      canDiscard: false,
      canIgnore: false,
    });
    expect(fileActions(f('a.ts', 'deleted'))).toEqual({ canDiscard: false, canIgnore: false });
    expect(fileActions(f('n.ts', 'untracked'))).toEqual({ canDiscard: true, canIgnore: true });
    expect(fileActions(f('.env', 'ignored'))).toEqual({ canDiscard: false, canIgnore: false });
  });
});

describe('oneChangePerPath', () => {
  it('keeps the unstaged change of a partly staged file, whichever comes first', () => {
    expect(oneChangePerPath([f('a.ts', 'added', true), f('a.ts')])).toEqual([f('a.ts')]);
    expect(oneChangePerPath([f('a.ts'), f('a.ts', 'added', true)])).toEqual([f('a.ts')]);
  });

  it('keeps every other change as it is', () => {
    const files = [f('a.ts', 'added', true), f('b.ts')];
    expect(oneChangePerPath(files)).toEqual(files);
  });
});

describe('stagedState', () => {
  const files = [f('a.ts', 'modified', true), f('b.ts'), f('c.ts', 'modified', true), f('c.ts')];

  it('is true when every change is staged, false when none is', () => {
    expect(stagedState(files, ['a.ts'])).toBe(true);
    expect(stagedState(files, ['b.ts'])).toBe(false);
  });

  it('is mixed for a partly staged file, or a folder of both', () => {
    expect(stagedState(files, ['c.ts'])).toBe('mixed');
    expect(stagedState(files, ['a.ts', 'b.ts'])).toBe('mixed');
  });

  it('is false for paths with no change', () => {
    expect(stagedState(files, ['z.ts'])).toBe(false);
  });
});
