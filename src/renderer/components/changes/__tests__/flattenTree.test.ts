import { describe, it, expect } from 'vitest';
import { buildTree } from '../buildTree';
import { flattenTree, FOLDER_TRUNCATION_CAP, type FlatRow } from '../flattenTree';
import type { FileChange } from '../../../../shared/types';

function f(path: string): FileChange {
  return { path, status: 'untracked', staged: false, additions: 0, deletions: 0 };
}

const closed = { open: new Map<string, boolean>(), showAll: new Set<string>() };

function describeRows(rows: FlatRow[]): string[] {
  return rows.map((r) =>
    r.kind === 'folder'
      ? `${'  '.repeat(r.indent)}${r.open ? 'v' : '>'} ${r.display}`
      : r.kind === 'file'
        ? `${'  '.repeat(r.indent)}${r.file.path}`
        : `+${r.hidden} in ${r.folderPath}`,
  );
}

describe('flattenTree', () => {
  it('lists folders before files, sorted, with compressed single-child chains', () => {
    const tree = buildTree([f('z.ts'), f('a/b/c/x.ts'), f('a/b/c/y.ts'), f('m.ts')]);
    expect(describeRows(flattenTree(tree, closed))).toEqual([
      'v a/b/c',
      '  a/b/c/x.ts',
      '  a/b/c/y.ts',
      'm.ts',
      'z.ts',
    ]);
  });

  it('collapses big folders by default and leaves their files out', () => {
    const many = Array.from({ length: 25 }, (_, i) => f(`vendor/${String(i).padStart(2, '0')}.js`));
    const rows = flattenTree(buildTree([...many, f('app.ts')]), closed);
    expect(describeRows(rows)).toEqual(['> vendor', 'app.ts']);
  });

  it('follows the open state the user set over the default', () => {
    const many = Array.from({ length: 25 }, (_, i) => f(`vendor/${String(i).padStart(2, '0')}.js`));
    const tree = buildTree([...many, f('src/a.ts')]);
    const state = {
      open: new Map([
        ['vendor', true],
        ['src', false],
      ]),
      showAll: new Set<string>(),
    };
    const rows = describeRows(flattenTree(tree, state));
    expect(rows[0]).toBe('> src');
    expect(rows[1]).toBe('v vendor');
    expect(rows).toHaveLength(2 + 25);
  });

  it('truncates a folder with many files until it is shown in full', () => {
    const many = Array.from({ length: 40 }, (_, i) => f(`${String(i).padStart(2, '0')}.ts`));
    const tree = buildTree(many);
    const rows = flattenTree(tree, closed);
    expect(rows).toHaveLength(FOLDER_TRUNCATION_CAP + 1);
    expect(rows.at(-1)).toMatchObject({ kind: 'more', folderPath: '', hidden: 10 });

    const all = flattenTree(tree, { open: new Map(), showAll: new Set(['']) });
    expect(all).toHaveLength(40);
  });

  it('prefixes keys so two sections can share one list', () => {
    const tree = buildTree([f('a/x.ts')]);
    const keys = flattenTree(tree, closed, 'staged:').map((r) => r.key);
    expect(keys).toEqual(['staged:d:a', 'staged:f:a/x.ts']);
  });
});
