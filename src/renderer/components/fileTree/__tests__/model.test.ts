import { describe, expect, it } from 'vitest';
import {
  buildTree,
  defaultOpen,
  flattenTree,
  folded,
  folderRowIndex,
  isSelected,
  revealKeys,
  subtreeChanges,
  treeColumns,
  treeKey,
  withViewed,
  SMART_COLLAPSE_THRESHOLD,
  type TreeRow,
  type TreeSection,
  type TreeState,
} from '../model';
import type { FileChange, FileChangeStatus } from '../../../../shared/types';

function f(
  path: string,
  status: FileChangeStatus = 'modified',
  staged = false,
  additions = 0,
  deletions = 0,
): FileChange {
  return { path, status, staged, additions, deletions };
}

const state = (over: Partial<TreeState> = {}): TreeState => ({
  open: new Map(),
  listings: new Map(),
  selected: null,
  ...over,
});

const one = (tree: ReturnType<typeof buildTree>): TreeSection[] => [{ id: 't', tree }];

/** Rows as an outline: "v dir" open, "> dir" closed, files by path. */
function outline(rows: TreeRow[]): string[] {
  return rows.map((r) => {
    const pad = 'depth' in r ? '  '.repeat(r.depth) : '';
    if (r.kind === 'section') return `# ${r.label}`;
    if (r.kind === 'folder') return `${pad}${r.open ? 'v' : '>'} ${r.name}`;
    if (r.kind === 'note') return `${pad}(${r.text})`;
    return `${pad}${r.file.path}`;
  });
}

describe('buildTree', () => {
  it('is an empty root with nothing changed', () => {
    const root = buildTree([]);
    expect(root.folders.size).toBe(0);
    expect(root.files).toEqual([]);
    expect(root.tally.changed).toBe(0);
  });

  it('nests files under their folders, each with its full path', () => {
    const root = buildTree([f('a/b/c.py'), f('README.md', 'modified', true, 5, 1)]);
    expect(root.files.map((x) => x.path)).toEqual(['README.md']);
    expect(root.folders.get('a')!.path).toBe('a');
    expect(root.folders.get('a')!.folders.get('b')!.path).toBe('a/b');
    expect(root.folders.get('a')!.folders.get('b')!.files[0]!.name).toBe('c.py');
  });

  it('tallies changes, lines and staged files up through its folders', () => {
    const root = buildTree([
      f('src/a/x.py', 'modified', true, 3, 1),
      f('src/b/y.py', 'modified', false, 7, 4),
    ]);
    const src = root.folders.get('src')!;
    expect(src.tally).toEqual({ changed: 2, add: 10, del: 5, untrackedAdd: 0, staged: 1 });
    expect(root.tally.changed).toBe(2);
  });

  it('keeps untracked files’ lines apart from tracked edits', () => {
    const root = buildTree([
      f('src/edited.py', 'modified', true, 4, 1),
      f('src/scratch/new.py', 'untracked', false, 100, 0),
    ]);
    expect(root.folders.get('src')!.tally).toMatchObject({ add: 4, del: 1, untrackedAdd: 100 });
  });

  it('lists one row per path, a later change winning', () => {
    const root = buildTree([f('a.ts', 'modified', true), f('a.ts', 'modified', false)]);
    expect(root.files).toHaveLength(1);
    expect(root.files[0]!.change!.staged).toBe(false);
  });

  it('adds the repo’s unchanged files beside the changes, deleted files included', () => {
    const root = buildTree([f('src/gone.ts', 'deleted')], {
      paths: ['src/kept.ts', 'b.ts'],
      dirs: [],
    });
    expect(root.folders.get('src')!.files.map((x) => [x.name, x.change?.status ?? null])).toEqual([
      ['gone.ts', 'deleted'],
      ['kept.ts', null],
    ]);
    expect(root.tally.changed).toBe(1);
  });

  it('lists ignored files quietly, uncounted, and ignored folders lazily', () => {
    const root = buildTree([], {
      paths: ['a.ts'],
      dirs: ['linked'],
      ignored: { files: ['.env'], dirs: ['node_modules'] },
    });
    const env = root.files.find((x) => x.path === '.env')!;
    expect(env).toMatchObject({ ignored: true, change: { status: 'ignored' } });
    expect(root.tally.changed).toBe(0);
    expect(root.folders.get('node_modules')).toMatchObject({ lazy: true, ignored: true });
    expect(root.folders.get('linked')).toMatchObject({ lazy: true, ignored: false });
  });

  it('gives a changed symlinked folder its own change', () => {
    const root = buildTree([f('linked', 'untracked')], { paths: [], dirs: ['linked'] });
    expect(root.files).toEqual([]);
    expect(root.folders.get('linked')!.change!.status).toBe('untracked');
    expect(root.tally.changed).toBe(1);
  });

  it('orders files by code unit (the editor tree’s order)', () => {
    const root = buildTree([f('package.json'), f('README.md')]);
    expect(root.files.map((x) => x.path)).toEqual(['README.md', 'package.json']);
  });
});

describe('subtreeChanges', () => {
  it('collects every change beneath a folder, not ignored files', () => {
    const root = buildTree([f('src/a.ts'), f('src/x/b.ts'), f('c.ts')], {
      paths: [],
      dirs: [],
      ignored: { files: ['src/.cache'], dirs: [] },
    });
    expect(subtreeChanges(root.folders.get('src')!).map((c) => c.path)).toEqual([
      'src/a.ts',
      'src/x/b.ts',
    ]);
  });
});

describe('folded', () => {
  it('keeps a folder with several entries as is', () => {
    const src = buildTree([f('src/a.py'), f('src/b.py')]).folders.get('src')!;
    expect(folded(src)).toEqual({ name: 'src', terminal: src, chain: ['src'] });
  });

  it('folds a chain of single-folder folders into one row', () => {
    const vendor = buildTree([f('vendor/parsers/json.py')]).folders.get('vendor')!;
    const { name, terminal, chain } = folded(vendor);
    expect(name).toBe('vendor/parsers');
    expect(terminal).toBe(vendor.folders.get('parsers'));
    expect(chain).toEqual(['vendor', 'vendor/parsers']);
  });

  it('stops at a folder with files of its own, or more than one folder', () => {
    const root = buildTree([f('a/b/c/x.py'), f('a/b/d/y.py'), f('s/root.py'), f('s/n/a.py')]);
    expect(folded(root.folders.get('a')!).name).toBe('a/b');
    expect(folded(root.folders.get('s')!).name).toBe('s');
  });
});

describe('flattenTree', () => {
  it('lists folders (folded) ahead of files, depth first', () => {
    const tree = buildTree([f('z.ts'), f('a/b/c/x.ts'), f('a/b/c/y.ts'), f('m.ts')]);
    expect(outline(flattenTree(one(tree), state()))).toEqual([
      'v a/b/c',
      '  a/b/c/x.ts',
      '  a/b/c/y.ts',
      'm.ts',
      'z.ts',
    ]);
  });

  it('orders sibling folders by name, ignoring case', () => {
    const tree = buildTree([f('Zeta/a.ts'), f('alpha/a.ts')]);
    expect(outline(flattenTree(one(tree), state()))[0]).toBe('v alpha');
  });

  it('collapses a folder with many changes by default and leaves its files out', () => {
    const many = Array.from({ length: SMART_COLLAPSE_THRESHOLD + 5 }, (_, i) =>
      f(`vendor/${String(i).padStart(2, '0')}.js`, 'untracked'),
    );
    const rows = flattenTree(one(buildTree([...many, f('app.ts')])), state());
    expect(outline(rows)).toEqual(['> vendor', 'app.ts']);
  });

  it('leaves unchanged folders closed, but opens the one holding the selection', () => {
    const tree = buildTree([], { paths: ['docs/a.md', 'src/x/b.ts', 'src/c.ts'], dirs: [] });
    expect(outline(flattenTree(one(tree), state()))).toEqual(['> docs', '> src']);
    const sel = state({ selected: { path: 'src/x/b.ts' } });
    expect(outline(flattenTree(one(tree), sel))).toEqual([
      '> docs',
      'v src',
      '  v x',
      '    src/x/b.ts',
      '  src/c.ts',
    ]);
  });

  it('follows the open state the user set over the default', () => {
    const many = Array.from({ length: 25 }, (_, i) => f(`vendor/${String(i).padStart(2, '0')}.js`));
    const tree = buildTree([...many, f('src/a.ts')]);
    const open = new Map([
      ['t:vendor', true],
      ['t:src', false],
    ]);
    const rows = outline(flattenTree(one(tree), state({ open })));
    expect(rows.slice(0, 2)).toEqual(['> src', 'v vendor']);
    expect(rows).toHaveLength(2 + 25);
  });

  it('heads each section and keys its rows apart, so two can share a path', () => {
    const sections: TreeSection[] = [
      { id: 'staged', label: 'Staged · 1', tree: buildTree([f('a/x.ts', 'modified', true)]) },
      { id: 'unstaged', label: 'Unstaged · 1', tree: buildTree([f('a/x.ts')]) },
    ];
    const rows = flattenTree(sections, state());
    expect(outline(rows)).toEqual([
      '# Staged · 1',
      'v a',
      '  a/x.ts',
      '# Unstaged · 1',
      'v a',
      '  a/x.ts',
    ]);
    expect(rows.map((r) => r.key)).toEqual([
      'staged:s',
      'staged:d:a',
      'staged:f:a/x.ts',
      'unstaged:s',
      'unstaged:d:a',
      'unstaged:f:a/x.ts',
    ]);
  });

  it('shows a lazy folder closed, then its listing (or its state) once open', () => {
    const tree = buildTree([], { paths: [], dirs: ['lib'], ignored: { files: [], dirs: ['nm'] } });
    expect(outline(flattenTree(one(tree), state()))).toEqual(['> lib', '> nm']);
    const open = new Map([
      ['t:lib', true],
      ['t:nm', true],
    ]);
    expect(outline(flattenTree(one(tree), state({ open })))).toEqual([
      'v lib',
      '  (Loading…)',
      'v nm',
      '  (Loading…)',
    ]);
    const listings = new Map([
      [
        'lib',
        [
          { name: 'sub', dir: true },
          { name: 'a.js', dir: false },
        ],
      ],
      ['nm', { error: 'EACCES' }],
    ]);
    const rows = flattenTree(one(tree), state({ open, listings }));
    expect(outline(rows)).toEqual(['v lib', '  > sub', '  lib/a.js', 'v nm', '  (EACCES)']);
    expect(rows[4]).toMatchObject({ kind: 'note', failed: true });
  });

  it('marks an ignored lazy folder’s files quiet', () => {
    const tree = buildTree([], { paths: [], dirs: [], ignored: { files: [], dirs: ['nm'] } });
    const rows = flattenTree(
      one(tree),
      state({
        open: new Map([['t:nm', true]]),
        listings: new Map([['nm', [{ name: 'x.js', dir: false }]]]),
      }),
    );
    expect(rows[1]).toMatchObject({ kind: 'file', file: { path: 'nm/x.js', ignored: true } });
  });

  it('says so when an opened lazy folder is empty', () => {
    const tree = buildTree([], { paths: [], dirs: ['lib'] });
    const rows = flattenTree(
      one(tree),
      state({ open: new Map([['t:lib', true]]), listings: new Map([['lib', []]]) }),
    );
    expect(outline(rows)).toEqual(['v lib', '  (Empty)']);
  });
});

describe('defaultOpen', () => {
  const tree = buildTree([f('src/a.ts')], { paths: ['docs/x.md'], dirs: ['lib'] });
  it('opens a changed folder, not an unchanged or lazy one', () => {
    expect(defaultOpen(tree.folders.get('src')!, null)).toBe(true);
    expect(defaultOpen(tree.folders.get('docs')!, null)).toBe(false);
    expect(defaultOpen(tree.folders.get('lib')!, 'lib/x')).toBe(false);
  });
  it('opens the folder holding the selection', () => {
    expect(defaultOpen(tree.folders.get('docs')!, 'docs/x.md')).toBe(true);
  });
});

describe('selection', () => {
  const sections: TreeSection[] = [
    { id: 'staged', label: 'S', tree: buildTree([f('a.ts', 'modified', true)]) },
    { id: 'unstaged', label: 'U', tree: buildTree([f('a.ts')]) },
  ];
  const rows = flattenTree(sections, state());
  const selectedKeys = (sel: Parameters<typeof isSelected>[1]) =>
    rows.filter((r) => isSelected(r, sel)).map((r) => r.key);

  it('selects the path in the named section only', () => {
    expect(selectedKeys({ path: 'a.ts', section: 'unstaged' })).toEqual(['unstaged:f:a.ts']);
  });

  it('selects the path in every section when none is named', () => {
    expect(selectedKeys({ path: 'a.ts' })).toEqual(['staged:f:a.ts', 'unstaged:f:a.ts']);
  });

  it('selects nothing without a selection', () => {
    expect(selectedKeys(null)).toEqual([]);
  });
});

describe('revealing a folder', () => {
  it('opens every folder holding it, and itself', () => {
    expect(revealKeys([{ id: 't', tree: buildTree([]) }], 'a/b/c')).toEqual([
      't:a',
      't:a/b',
      't:a/b/c',
    ]);
  });

  it('finds the row standing for it, inside a folded chain too', () => {
    const rows = flattenTree(one(buildTree([f('x.ts'), f('a/b/c/y.ts')])), state());
    expect(folderRowIndex(rows, 'a/b')).toBe(0);
    expect(folderRowIndex(rows, 'nope')).toBe(-1);
  });
});

describe('treeColumns', () => {
  const tree = buildTree([
    f('a.ts', 'modified', false, 120, 3),
    ...Array.from({ length: 12 }, (_, i) => f(`dir/${i}.ts`, 'untracked', false, 100, 0)),
  ]);

  it('sizes each column to the widest value shown, an open folder’s sum left out', () => {
    // dir/ starts open (12 changes): its +1200 isn't shown, its files' +100 are.
    expect(treeColumns(flattenTree(one(tree), state()))).toEqual({
      threads: false,
      comments: false,
      add: 4, // "+120"
      del: 2,
      status: true, // files' letters; folders show no count
      viewed: false,
    });
  });

  it('counts a closed folder’s lines', () => {
    const closed = state({ open: new Map([['t:dir', false]]) });
    expect(treeColumns(flattenTree(one(tree), closed)).add).toBe(5); // "+1200"
  });

  it('draws the badge columns only when a file has one', () => {
    const rows = flattenTree(one(buildTree([f('a.ts')])), state());
    const badges = new Map([['a.ts', { comments: 0, threads: 2 }]]);
    expect(treeColumns(rows, badges)).toMatchObject({ threads: true, comments: false });
  });

  it('draws no columns for a tree with no changes', () => {
    const rows = flattenTree(one(buildTree([], { paths: ['a.ts'], dirs: [] })), state());
    expect(treeColumns(rows)).toEqual({
      threads: false,
      comments: false,
      add: 0,
      del: 0,
      status: false,
      viewed: false,
    });
  });

  it('draws the viewed column for a tree that marks files viewed', () => {
    const rows = flattenTree(one(buildTree([f('a.ts'), f('b.ts')])), state());
    const badges = withViewed(new Map(), [{ path: 'a.ts' }, { path: 'b.ts' }], new Set(['b.ts']));
    expect(treeColumns(rows, badges).viewed).toBe(true);
    expect(treeColumns(rows).viewed).toBe(false);
  });
});

describe('withViewed', () => {
  it('marks every changed file viewed or not, keeping its other badges', () => {
    const badges = new Map([['a.ts', { comments: 1, threads: 2 }]]);
    const out = withViewed(badges, [{ path: 'a.ts' }, { path: 'b.ts' }], new Set(['b.ts']));
    expect(out.get('a.ts')).toEqual({ comments: 1, threads: 2, viewed: false });
    expect(out.get('b.ts')).toEqual({ comments: 0, threads: 0, viewed: true });
    expect(badges.get('a.ts')).toEqual({ comments: 1, threads: 2 }); // untouched
  });
});

describe('treeKey', () => {
  const sections: TreeSection[] = [
    { id: 's', label: 'S', tree: buildTree([f('a/x.ts', 'modified', true), f('b.ts')]) },
  ];
  // # S · v a · a/x.ts · b.ts
  const rows = flattenTree(sections, state());

  it('walks the rows, skipping headers', () => {
    expect(treeKey(rows, 1, 'ArrowDown')).toEqual({ focus: 2 });
    expect(treeKey(rows, 1, 'ArrowUp')).toBeNull();
    expect(treeKey(rows, 3, 'ArrowDown')).toBeNull();
    expect(treeKey(rows, 3, 'Home')).toEqual({ focus: 1 });
    expect(treeKey(rows, 1, 'End')).toEqual({ focus: 3 });
  });

  it('closes an open folder on Left, and steps out to it from inside', () => {
    expect(treeKey(rows, 1, 'ArrowLeft')).toEqual({ toggle: 1 });
    expect(treeKey(rows, 2, 'ArrowLeft')).toEqual({ focus: 1 });
    expect(treeKey(rows, 3, 'ArrowLeft')).toBeNull();
  });

  it('steps into an open folder on Right, opens a closed one', () => {
    expect(treeKey(rows, 1, 'ArrowRight')).toEqual({ focus: 2 });
    const closed = flattenTree(sections, state({ open: new Map([['s:a', false]]) }));
    expect(treeKey(closed, 1, 'ArrowRight')).toEqual({ toggle: 1 });
    expect(treeKey(rows, 2, 'ArrowRight')).toBeNull();
  });

  it('leaves other keys to the row', () => {
    expect(treeKey(rows, 2, 'Enter')).toBeNull();
  });
});
