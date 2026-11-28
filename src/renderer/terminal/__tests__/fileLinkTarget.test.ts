import { describe, it, expect } from 'vitest';
import { linkRange, resolveLinkPath } from '../fileLinkTarget';

describe('resolveLinkPath', () => {
  it('resolves a relative path against the cwd', () => {
    expect(resolveLinkPath('/w/task/src', './a/b.ts')).toBe('/w/task/src/a/b.ts');
    expect(resolveLinkPath('/w/task/src', '../lib/c.ts')).toBe('/w/task/lib/c.ts');
  });

  it('keeps an absolute path', () => {
    expect(resolveLinkPath('/elsewhere', '/w/task/a.ts')).toBe('/w/task/a.ts');
  });

  it('gives up on a non-POSIX cwd', () => {
    expect(resolveLinkPath('C:\\w\\task', 'src/a.ts')).toBeNull();
  });
});

describe('linkRange', () => {
  it('puts the caret at line:col, col 1 when absent', () => {
    expect(linkRange(12, 4)).toEqual({
      startLineNumber: 12,
      startColumn: 4,
      endLineNumber: 12,
      endColumn: 4,
    });
    expect(linkRange(3)?.startColumn).toBe(1);
  });

  it('is none without a line', () => {
    expect(linkRange()).toBeUndefined();
  });
});
