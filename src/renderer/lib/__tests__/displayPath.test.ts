import { describe, expect, it } from 'vitest';
import { splitForMiddleTruncation, tildePath } from '../displayPath';

describe('tildePath', () => {
  it('shows the home folder as ~', () => {
    expect(tildePath('/Users/a/repos/x', '/Users/a')).toBe('~/repos/x');
    expect(tildePath('/Users/a', '/Users/a/')).toBe('~');
  });

  it('leaves other paths, and a home that is only a prefix, alone', () => {
    expect(tildePath('/Users/ab/x', '/Users/a')).toBe('/Users/ab/x');
    expect(tildePath('/tmp/x', '/Users/a')).toBe('/tmp/x');
    expect(tildePath('/tmp/x', '')).toBe('/tmp/x');
  });
});

describe('splitForMiddleTruncation', () => {
  it('keeps the last segment whole', () => {
    expect(splitForMiddleTruncation('~/repos/dash/worktrees/fix-bug')).toEqual([
      '~/repos/dash/worktrees/',
      'fix-bug',
    ]);
    expect(splitForMiddleTruncation('/a/b/')).toEqual(['/a/', 'b']);
  });

  it('has no head for a single segment', () => {
    expect(splitForMiddleTruncation('~')).toEqual(['', '~']);
    expect(splitForMiddleTruncation('/a')).toEqual(['', '/a']);
  });
});
