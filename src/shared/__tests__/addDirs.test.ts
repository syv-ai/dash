import { describe, it, expect } from 'vitest';
import { addDirProblem, isAbsoluteFolder, normalizeAddDirs, sameAddDirs } from '../addDirs';

describe('addDirs', () => {
  it('knows a full path on any platform', () => {
    expect(isAbsoluteFolder('/Users/me/lib')).toBe(true);
    expect(isAbsoluteFolder('C:\\code')).toBe(true);
    expect(isAbsoluteFolder('\\\\server\\share')).toBe(true);
    expect(isAbsoluteFolder('~/lib')).toBe(false);
    expect(isAbsoluteFolder('../lib')).toBe(false);
  });

  it('trims, drops blanks and keeps each folder once, in order', () => {
    expect(normalizeAddDirs([' /a ', '', '/b', '/a', '  '])).toEqual(['/a', '/b']);
    expect(normalizeAddDirs(null)).toEqual([]);
  });

  it('names a folder that is not a full path, and lets a blank row be', () => {
    expect(addDirProblem('~/lib')).toMatch(/isn't a full path/);
    expect(addDirProblem('/lib')).toBeNull();
    expect(addDirProblem('  ')).toBeNull();
  });

  it('compares lists once normalized', () => {
    expect(sameAddDirs(['/a ', ''], ['/a'])).toBe(true);
    expect(sameAddDirs(['/a', '/b'], ['/b', '/a'])).toBe(false);
    expect(sameAddDirs(null, [])).toBe(true);
  });
});
