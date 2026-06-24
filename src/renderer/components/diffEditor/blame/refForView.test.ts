import { describe, it, expect } from 'vitest';
import { refForView } from './refForView';

describe('refForView', () => {
  it('blames the working file (null ref) for working and branch views', () => {
    expect(refForView({ kind: 'working', ref: 'HEAD' })).toBeNull();
    expect(refForView({ kind: 'working', ref: 'index' })).toBeNull();
    expect(refForView({ kind: 'branch', base: 'main' })).toBeNull();
  });

  it('blames at the commit hash for a commit view', () => {
    expect(refForView({ kind: 'commit', hash: 'abc1234' })).toBe('abc1234');
  });
});
