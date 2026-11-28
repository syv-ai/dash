import { describe, it, expect } from 'vitest';
import { resolveIsDark } from '../theme';

describe('resolveIsDark', () => {
  it('follows the OS under System', () => {
    expect(resolveIsDark('system', true)).toBe(true);
    expect(resolveIsDark('system', false)).toBe(false);
  });

  it('holds a fixed choice whatever the OS says', () => {
    expect(resolveIsDark('dark', false)).toBe(true);
    expect(resolveIsDark('light', true)).toBe(false);
  });
});
