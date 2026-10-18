import { describe, it, expect } from 'vitest';
import { isPrScope, parsePrScope, prScope } from '../prScope';

describe('prScope', () => {
  it('round-trips a PR scope', () => {
    expect(prScope('github', 812)).toBe('pr:github:812');
    expect(parsePrScope(prScope('ado', 7))).toEqual({ provider: 'ado', number: 7 });
  });

  it('rejects other scopes and the old pr:<n> form', () => {
    expect(parsePrScope('commit:abc')).toBeNull();
    expect(parsePrScope('live')).toBeNull();
    expect(parsePrScope('pr:7')).toBeNull();
    expect(parsePrScope('pr:gitlab:7')).toBeNull();
  });

  it('tells PR scopes apart', () => {
    expect(isPrScope('pr:github:1')).toBe(true);
    expect(isPrScope('commit:abc')).toBe(false);
  });
});
