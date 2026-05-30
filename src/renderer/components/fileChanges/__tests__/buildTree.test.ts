import { describe, it, expect } from 'vitest';
import { buildTree, compressedDisplay } from '../buildTree';
import type { FileChange, FileChangeStatus } from '../../../../shared/types';

function f(
  path: string,
  status: FileChangeStatus,
  staged = false,
  additions = 0,
  deletions = 0,
): FileChange {
  return { path, status, staged, additions, deletions };
}

describe('buildTree', () => {
  it('returns a root with no children for empty input', () => {
    const root = buildTree([]);
    expect(root.children.size).toBe(0);
    expect(root.files).toEqual([]);
    expect(root.agg.count).toBe(0);
  });

  it('places a root-level file in root.files', () => {
    const root = buildTree([f('README.md', 'modified', true, 5, 1)]);
    expect(root.files).toHaveLength(1);
    expect(root.children.size).toBe(0);
    expect(root.agg.count).toBe(1);
    expect(root.agg.add).toBe(5);
    expect(root.agg.del).toBe(1);
  });

  it('builds nested directories from path segments', () => {
    const root = buildTree([
      f('src/payments/refund.py', 'modified', true, 10, 2),
      f('src/payments/charge.py', 'modified', true, 4, 1),
    ]);
    expect(root.children.has('src')).toBe(true);
    const src = root.children.get('src')!;
    expect(src.children.has('payments')).toBe(true);
    const payments = src.children.get('payments')!;
    expect(payments.files).toHaveLength(2);
    expect(payments.agg.count).toBe(2);
    expect(src.agg.count).toBe(2);
    expect(root.agg.count).toBe(2);
  });

  it('aggregates additions and deletions through the tree', () => {
    const root = buildTree([
      f('src/a/x.py', 'modified', true, 3, 1),
      f('src/b/y.py', 'modified', true, 7, 4),
    ]);
    expect(root.agg.add).toBe(10);
    expect(root.agg.del).toBe(5);
    expect(root.children.get('src')!.agg.add).toBe(10);
  });

  it('computes status as a single value when homogeneous', () => {
    const root = buildTree([f('vendor/a.py', 'untracked'), f('vendor/b.py', 'untracked')]);
    expect(root.children.get('vendor')!.agg.status).toBe('untracked');
  });

  it('picks the highest-priority status when descendants differ (modified > added)', () => {
    const root = buildTree([f('src/a.py', 'modified', true), f('src/b.py', 'added', true)]);
    expect(root.children.get('src')!.agg.status).toBe('modified');
  });

  it('cascades the modified status up through ancestor folders mixed with untracked', () => {
    const root = buildTree([
      f('src/utils/format.py', 'modified', true, 4, 1),
      f('src/scratch/new1.py', 'untracked'),
      f('src/scratch/new2.py', 'untracked'),
    ]);
    // src/ has a modified file deep inside plus untracked siblings — the dominant
    // status for the tint should still be 'modified', not 'mixed' or 'untracked'.
    expect(root.children.get('src')!.agg.status).toBe('modified');
  });

  it('keeps untracked when every descendant is untracked', () => {
    const root = buildTree([
      f('vendor/parsers/a.py', 'untracked'),
      f('vendor/parsers/b.py', 'untracked'),
    ]);
    expect(root.children.get('vendor')!.agg.status).toBe('untracked');
  });

  it('keeps untracked line counts separate from tracked add/del', () => {
    const root = buildTree([
      f('src/edited.py', 'modified', true, 4, 1),
      f('src/scratch/new.py', 'untracked', false, 100, 0),
    ]);
    const src = root.children.get('src')!;
    expect(src.agg.add).toBe(4);
    expect(src.agg.del).toBe(1);
    expect(src.agg.untrackedAdd).toBe(100);
  });

  it('only attributes untrackedAdd for pure-untracked folders', () => {
    const root = buildTree([
      f('vendor/parsers/a.py', 'untracked', false, 50, 0),
      f('vendor/parsers/b.py', 'untracked', false, 75, 0),
    ]);
    const vendor = root.children.get('vendor')!;
    expect(vendor.agg.add).toBe(0);
    expect(vendor.agg.del).toBe(0);
    expect(vendor.agg.untrackedAdd).toBe(125);
  });

  it('computes stageState as true when all descendants staged', () => {
    const root = buildTree([f('src/a.py', 'modified', true), f('src/b.py', 'added', true)]);
    expect(root.children.get('src')!.agg.stageState).toBe(true);
  });

  it('computes stageState as false when none staged', () => {
    const root = buildTree([f('src/a.py', 'modified', false), f('src/b.py', 'added', false)]);
    expect(root.children.get('src')!.agg.stageState).toBe(false);
  });

  it('computes stageState as "mixed" when some staged and some not', () => {
    const root = buildTree([f('src/a.py', 'modified', true), f('src/b.py', 'added', false)]);
    expect(root.children.get('src')!.agg.stageState).toBe('mixed');
  });

  it('sets path on each node to its full path from root', () => {
    const root = buildTree([f('a/b/c.py', 'modified', true)]);
    expect(root.children.get('a')!.path).toBe('a');
    expect(root.children.get('a')!.children.get('b')!.path).toBe('a/b');
  });
});

describe('compressedDisplay', () => {
  it('returns the single segment when the node has multiple children', () => {
    const root = buildTree([f('src/a.py', 'modified', true), f('src/b.py', 'modified', true)]);
    const src = root.children.get('src')!;
    const result = compressedDisplay(src);
    expect(result.display).toBe('src');
    expect(result.terminal).toBe(src);
  });

  it('folds a chain of single-child directories with no files', () => {
    const root = buildTree([f('vendor/parsers/json_001.py', 'untracked')]);
    const vendor = root.children.get('vendor')!;
    const result = compressedDisplay(vendor);
    expect(result.display).toBe('vendor/parsers');
    expect(result.terminal).toBe(vendor.children.get('parsers'));
  });

  it('does not fold when the node has files of its own', () => {
    const root = buildTree([
      f('src/root.py', 'modified', true),
      f('src/nested/a.py', 'modified', true),
    ]);
    const src = root.children.get('src')!;
    expect(compressedDisplay(src).display).toBe('src');
    expect(compressedDisplay(src).terminal).toBe(src);
  });

  it('does not fold past a node that has multiple children', () => {
    const root = buildTree([f('a/b/c/x.py', 'modified', true), f('a/b/d/y.py', 'modified', true)]);
    const a = root.children.get('a')!;
    const result = compressedDisplay(a);
    expect(result.display).toBe('a/b');
    expect(result.terminal).toBe(a.children.get('b'));
  });
});
