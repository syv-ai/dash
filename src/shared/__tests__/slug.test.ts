import { describe, it, expect } from 'vitest';
import { branchSlug, slugify } from '../slug';

describe('slugify', () => {
  it('lowercases and hyphenates non-alphanumeric runs', () => {
    expect(slugify('My Cool Task')).toBe('my-cool-task');
    expect(slugify('feat/Add Thing')).toBe('feat-add-thing');
    expect(slugify('a  b   c')).toBe('a-b-c');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('  spaced  ')).toBe('spaced');
    expect(slugify('***edge***')).toBe('edge');
  });

  it('caps at 50 characters', () => {
    const long = 'a'.repeat(80);
    expect(slugify(long)).toHaveLength(50);
  });

  it('returns an empty string when nothing alphanumeric remains', () => {
    expect(slugify('***')).toBe('');
  });
});

describe('branchSlug', () => {
  it('keeps slashes, slugifying each part', () => {
    expect(branchSlug('feature/Add Thing')).toBe('feature/add-thing');
    expect(branchSlug('team/fix/Login bug')).toBe('team/fix/login-bug');
  });

  it('matches slugify for a name without slashes', () => {
    expect(branchSlug('My Cool Task')).toBe(slugify('My Cool Task'));
  });

  it('drops empty and symbol-only parts', () => {
    expect(branchSlug('/feature//foo/')).toBe('feature/foo');
    expect(branchSlug('feature/***/foo')).toBe('feature/foo');
    expect(branchSlug('***')).toBe('');
  });
});
