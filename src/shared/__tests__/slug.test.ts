import { describe, it, expect } from 'vitest';
import { slugify } from '../slug';

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
