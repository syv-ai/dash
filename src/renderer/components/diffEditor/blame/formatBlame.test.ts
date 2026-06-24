import { describe, it, expect } from 'vitest';
import { blameLabel, contiguousBlock } from './formatBlame';
import type { BlameLine } from '@shared/types';

const NOW = 1_700_000_000;

function line(overrides: Partial<BlameLine> = {}): BlameLine {
  return {
    line: 1,
    sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    shortSha: 'aaaaaaa',
    author: 'Nicolai Thomsen',
    authorEmail: 'nicolai@syv.ai',
    authorTime: NOW - 3 * 86400,
    summary: 'Diff comments: robust anchoring',
    uncommitted: false,
    ...overrides,
  };
}

describe('blameLabel', () => {
  it('breaks a committed line into structured fields', () => {
    expect(blameLabel(line(), NOW)).toEqual({
      author: 'Nicolai Thomsen',
      age: '3d',
      shortSha: 'aaaaaaa',
      summary: 'Diff comments: robust anchoring',
      uncommitted: false,
    });
  });

  it('collapses uncommitted lines to a single phrase', () => {
    expect(blameLabel(line({ uncommitted: true }), NOW)).toEqual({
      author: 'Uncommitted changes',
      age: '',
      shortSha: '',
      summary: '',
      uncommitted: true,
    });
  });
});

describe('contiguousBlock', () => {
  const lines: BlameLine[] = [
    line({ line: 1, sha: 'a', shortSha: 'aaaaaaa' }),
    line({ line: 2, sha: 'a', shortSha: 'aaaaaaa' }),
    line({ line: 3, sha: 'b', shortSha: 'bbbbbbb' }),
    line({ line: 4, sha: 'a', shortSha: 'aaaaaaa' }),
    line({ line: 5, sha: 'a', shortSha: 'aaaaaaa' }),
  ];

  it('expands to the full same-commit run around the target', () => {
    expect(contiguousBlock(lines, 1)).toEqual({ start: 1, end: 2 });
    expect(contiguousBlock(lines, 2)).toEqual({ start: 1, end: 2 });
    expect(contiguousBlock(lines, 5)).toEqual({ start: 4, end: 5 });
  });

  it('does not jump across a different commit between two runs of the same sha', () => {
    expect(contiguousBlock(lines, 4)).toEqual({ start: 4, end: 5 });
  });

  it('returns a single-line block for an isolated commit', () => {
    expect(contiguousBlock(lines, 3)).toEqual({ start: 3, end: 3 });
  });

  it('returns null for an out-of-range line', () => {
    expect(contiguousBlock(lines, 0)).toBeNull();
    expect(contiguousBlock(lines, 99)).toBeNull();
  });
});
