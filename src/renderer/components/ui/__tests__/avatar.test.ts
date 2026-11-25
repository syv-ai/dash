import { describe, it, expect } from 'vitest';
import { initials } from '../Avatar';
import { nextSuggestion } from '../SuggestionMenu';

describe('initials', () => {
  it("takes a display name's first and last words", () => {
    expect(initials('Ann Reviewer')).toBe('AR');
    expect(initials('Ann B. Reviewer')).toBe('AR');
  });

  it("takes a login's first letter, splitting on its separators", () => {
    expect(initials('nthomsencph')).toBe('N');
    expect(initials('simo787c')).toBe('S');
    expect(initials('jo-ann_lee')).toBe('JL');
  });

  it('copes with nothing to take', () => {
    expect(initials('')).toBe('?');
    expect(initials('  -- ')).toBe('?');
  });
});

describe('nextSuggestion', () => {
  it('moves and wraps round', () => {
    expect(nextSuggestion(0, 1, 3)).toBe(1);
    expect(nextSuggestion(2, 1, 3)).toBe(0);
    expect(nextSuggestion(0, -1, 3)).toBe(2);
    expect(nextSuggestion(0, 1, 0)).toBe(0);
  });
});
