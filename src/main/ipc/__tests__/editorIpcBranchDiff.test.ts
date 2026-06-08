import { describe, it, expect } from 'vitest';
import { parseDiffNameStatusZ, parseDiffNumstatZ } from '../editorIpc';

describe('parseDiffNameStatusZ', () => {
  it('parses M, A, D entries', () => {
    // `git diff --name-status -z` outputs: <code>\0<path>\0 repeated.
    const out = ['M', 'src/a.ts', 'A', 'src/b.ts', 'D', 'src/c.ts', ''].join('\0');
    expect(parseDiffNameStatusZ(out)).toEqual([
      { status: 'modified', path: 'src/a.ts', oldPath: undefined },
      { status: 'added', path: 'src/b.ts', oldPath: undefined },
      { status: 'deleted', path: 'src/c.ts', oldPath: undefined },
    ]);
  });

  it('parses renames as R<score>\\0<old>\\0<new>', () => {
    const out = ['R100', 'src/old.ts', 'src/new.ts', ''].join('\0');
    expect(parseDiffNameStatusZ(out)).toEqual([
      { status: 'renamed', path: 'src/new.ts', oldPath: 'src/old.ts' },
    ]);
  });

  it('treats copies (C<score>) like renames', () => {
    const out = ['C075', 'src/a.ts', 'src/a-copy.ts', ''].join('\0');
    expect(parseDiffNameStatusZ(out)).toEqual([
      { status: 'renamed', path: 'src/a-copy.ts', oldPath: 'src/a.ts' },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(parseDiffNameStatusZ('')).toEqual([]);
  });

  it('skips trailing NUL without emitting a phantom entry', () => {
    const out = ['M', 'src/a.ts'].join('\0') + '\0';
    expect(parseDiffNameStatusZ(out)).toEqual([
      { status: 'modified', path: 'src/a.ts', oldPath: undefined },
    ]);
  });
});

describe('parseDiffNumstatZ', () => {
  it('parses additions and deletions keyed by path', () => {
    // `git diff --numstat -z` outputs: <adds>\t<dels>\t<path>\0 per file.
    const out = ['12\t3\tsrc/a.ts', '0\t9\tsrc/b.ts', ''].join('\0');
    const map = parseDiffNumstatZ(out);
    expect(map.get('src/a.ts')).toEqual({ additions: 12, deletions: 3 });
    expect(map.get('src/b.ts')).toEqual({ additions: 0, deletions: 9 });
  });

  it('treats "-" (binary) as 0/0', () => {
    const out = '-\t-\tbinary.png\0';
    const map = parseDiffNumstatZ(out);
    expect(map.get('binary.png')).toEqual({ additions: 0, deletions: 0 });
  });

  it('handles rename triplets: <adds>\\t<dels>\\t<old>\\0<new>\\0', () => {
    // numstat -z emits old then new on rename. Stats belong to the new path.
    const out = ['5\t2\tsrc/old.ts', 'src/new.ts', ''].join('\0');
    const map = parseDiffNumstatZ(out);
    expect(map.get('src/new.ts')).toEqual({ additions: 5, deletions: 2 });
  });

  it('returns an empty map for empty input', () => {
    expect(parseDiffNumstatZ('').size).toBe(0);
  });
});
