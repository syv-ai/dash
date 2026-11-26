import { describe, it, expect } from 'vitest';
import { tabStopKey, treeKey, type TreeNode } from '../treeNav';

const branch = (key: string, depth: number, open: boolean): TreeNode => ({
  key,
  depth,
  open,
  focusable: true,
});
const leaf = (key: string, depth: number): TreeNode => ({ key, depth, focusable: true });
const heading = (key: string): TreeNode => ({ key, depth: -1, focusable: false });

// # A · v p · t1 · t2 · (gap) · > q · # B · r
const rows: TreeNode[] = [
  heading('A'),
  branch('p', 0, true),
  leaf('t1', 1),
  leaf('t2', 1),
  { key: 'gap', depth: 1, focusable: false },
  branch('q', 0, false),
  heading('B'),
  leaf('r', 0),
];

describe('treeKey', () => {
  it('walks the focusable rows, skipping headings and gaps', () => {
    expect(treeKey(rows, 1, 'ArrowDown')).toEqual({ focus: 2 });
    expect(treeKey(rows, 3, 'ArrowDown')).toEqual({ focus: 5 });
    expect(treeKey(rows, 5, 'ArrowDown')).toEqual({ focus: 7 });
    expect(treeKey(rows, 1, 'ArrowUp')).toBeNull();
    expect(treeKey(rows, 7, 'ArrowDown')).toBeNull();
    expect(treeKey(rows, 5, 'Home')).toEqual({ focus: 1 });
    expect(treeKey(rows, 1, 'End')).toEqual({ focus: 7 });
  });

  it('closes an open branch on Left, and steps out to it from inside', () => {
    expect(treeKey(rows, 1, 'ArrowLeft')).toEqual({ toggle: 1 });
    expect(treeKey(rows, 3, 'ArrowLeft')).toEqual({ focus: 1 });
  });

  it('never steps out past a heading or onto a leaf', () => {
    expect(treeKey(rows, 7, 'ArrowLeft')).toBeNull();
    expect(treeKey(rows, 5, 'ArrowLeft')).toBeNull();
    const underLeaf = [leaf('x', 0), leaf('y', 1)];
    expect(treeKey(underLeaf, 1, 'ArrowLeft')).toBeNull();
  });

  it('steps into an open branch on Right, opens a closed one, ignores a leaf', () => {
    expect(treeKey(rows, 1, 'ArrowRight')).toEqual({ focus: 2 });
    expect(treeKey(rows, 5, 'ArrowRight')).toEqual({ toggle: 5 });
    expect(treeKey(rows, 2, 'ArrowRight')).toBeNull();
  });

  it('leaves other keys, and rows the keys never land on, to the row', () => {
    expect(treeKey(rows, 2, 'Enter')).toBeNull();
    expect(treeKey(rows, 0, 'ArrowLeft')).toBeNull();
  });
});

describe('tabStopKey', () => {
  it('keeps the last focused row while it shows', () => {
    expect(tabStopKey(rows, 't2', 7)).toBe('t2');
  });
  it('else the selected row, else the first focusable', () => {
    expect(tabStopKey(rows, 'gone', 7)).toBe('r');
    expect(tabStopKey(rows, null, -1)).toBe('p');
    expect(tabStopKey([], null, -1)).toBeUndefined();
  });
});
