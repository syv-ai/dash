import { describe, it, expect } from 'vitest';
import { defaultEffortFrom, isTaskEffort } from '../effort';

describe('effort', () => {
  it('knows the levels and ultracode, nothing else', () => {
    expect(isTaskEffort('xhigh')).toBe(true);
    expect(isTaskEffort('ultracode')).toBe(true);
    expect(isTaskEffort('auto')).toBe(false);
    expect(isTaskEffort(null)).toBe(false);
  });

  it("folds Settings' Effort and Ultracode into one default, ultracode first", () => {
    expect(defaultEffortFrom('high', false)).toBe('high');
    expect(defaultEffortFrom('high', true)).toBe('ultracode');
    expect(defaultEffortFrom('auto', false)).toBeNull();
    expect(defaultEffortFrom('auto', true)).toBe('ultracode');
  });
});
