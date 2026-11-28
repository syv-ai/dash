import { describe, it, expect } from 'vitest';
import { defaultEffortFrom, isTaskEffort } from '../effort';

describe('effort', () => {
  it('knows the levels and ultracode, nothing else', () => {
    expect(isTaskEffort('xhigh')).toBe(true);
    expect(isTaskEffort('ultracode')).toBe(true);
    expect(isTaskEffort('auto')).toBe(false);
    expect(isTaskEffort(null)).toBe(false);
  });

  it("gives a task Settings' effort, none for Auto", () => {
    expect(defaultEffortFrom('high')).toBe('high');
    expect(defaultEffortFrom('ultracode')).toBe('ultracode');
    expect(defaultEffortFrom('auto')).toBeNull();
  });
});
