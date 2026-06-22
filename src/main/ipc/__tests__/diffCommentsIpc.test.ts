import { describe, it, expect } from 'vitest';
import { computeOrphans } from '../diffCommentsIpc';

describe('computeOrphans', () => {
  it('returns ids of comments whose path is not in the existing set', () => {
    const rows = [
      { id: 'a', file_path: 'src/foo.ts' },
      { id: 'b', file_path: 'src/bar.ts' },
      { id: 'c', file_path: 'src/missing.ts' },
    ];
    const existing = new Set(['src/foo.ts', 'src/bar.ts']);
    expect(computeOrphans(rows, existing)).toEqual(['c']);
  });

  it('returns [] when every path exists', () => {
    const rows = [
      { id: 'a', file_path: 'src/foo.ts' },
      { id: 'b', file_path: 'src/bar.ts' },
    ];
    const existing = new Set(['src/foo.ts', 'src/bar.ts']);
    expect(computeOrphans(rows, existing)).toEqual([]);
  });

  it('returns every id when the existing set is empty', () => {
    const rows = [
      { id: 'a', file_path: 'src/foo.ts' },
      { id: 'b', file_path: 'src/bar.ts' },
    ];
    expect(computeOrphans(rows, new Set())).toEqual(['a', 'b']);
  });
});
