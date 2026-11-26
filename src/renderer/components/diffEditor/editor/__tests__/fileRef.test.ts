import { describe, it, expect } from 'vitest';
import { fileRef, absolutePath, isOutsideWorktree } from '../fileRef';

describe('fileRef', () => {
  it('is path:line for a single line', () => {
    expect(fileRef('src/a.ts', { start: 12, end: 12 })).toBe('src/a.ts:12');
  });
  it('is path:start-end for a range', () => {
    expect(fileRef('src/a.ts', { start: 12, end: 18 })).toBe('src/a.ts:12-18');
  });
  it('orders a range selected bottom-up', () => {
    expect(fileRef('src/a.ts', { start: 18, end: 12 })).toBe('src/a.ts:12-18');
  });
  it('is just the path without lines', () => {
    expect(fileRef('src/a.ts', null)).toBe('src/a.ts');
  });
});

describe('absolutePath', () => {
  it('joins cwd and the repo-relative path with one slash', () => {
    expect(absolutePath('/repo/', 'src/a.ts')).toBe('/repo/src/a.ts');
    expect(absolutePath('/repo', 'src/a.ts')).toBe('/repo/src/a.ts');
  });
  it("is an outside file's own absolute path", () => {
    expect(absolutePath('/repo', '/home/me/.claude/projects/x/memory/a.md')).toBe(
      '/home/me/.claude/projects/x/memory/a.md',
    );
  });
});

describe('isOutsideWorktree', () => {
  it('is a tab named by its absolute path, not a repo-relative one', () => {
    expect(isOutsideWorktree('/tmp/scratch/a.md')).toBe(true);
    expect(isOutsideWorktree('src/a.ts')).toBe(false);
    expect(isOutsideWorktree('.claude/CLAUDE.md')).toBe(false);
  });
});
