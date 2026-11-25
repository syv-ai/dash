import { describe, it, expect } from 'vitest';
import { refForView } from './refForView';

describe('refForView', () => {
  it('blames the working file (null ref) for a working view', () => {
    expect(refForView({ kind: 'working', ref: 'HEAD' })).toBeNull();
    expect(refForView({ kind: 'working', ref: 'index' })).toBeNull();
  });

  it('blames at the commit hash for a commit view', () => {
    expect(refForView({ kind: 'commit', hash: 'abc1234' })).toBe('abc1234');
  });

  it("blames a PR view at its head, or the working file when it's live", () => {
    const pr = { kind: 'pr', provider: 'github', number: 1, base: 'b', head: 'h' } as const;
    expect(refForView(pr)).toBe('h');
    expect(refForView({ ...pr, live: true })).toBeNull();
  });
});
