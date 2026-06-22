import { describe, it, expect } from 'vitest';
import { detectCreatedFolder } from './ScaffoldService';

describe('detectCreatedFolder', () => {
  it('returns the single new entry', () => {
    expect(detectCreatedFolder(['a', 'b'], ['a', 'b', 'my-pkg'])).toBe('my-pkg');
  });

  it('returns null when nothing new appeared', () => {
    expect(detectCreatedFolder(['a'], ['a'])).toBeNull();
  });

  it('returns null when multiple new entries appeared (ambiguous)', () => {
    expect(detectCreatedFolder([], ['x', 'y'])).toBeNull();
  });

  it('ignores entries that disappeared', () => {
    expect(detectCreatedFolder(['a', 'b'], ['a', 'new'])).toBe('new');
  });
});
