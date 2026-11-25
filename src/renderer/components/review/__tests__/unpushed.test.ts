import { describe, expect, it } from 'vitest';
import { headMovedPast } from '../unpushed';

describe('headMovedPast', () => {
  it('holds only when both heads are known and differ', () => {
    expect(headMovedPast('b', 'a')).toBe(true);
    expect(headMovedPast('a', 'a')).toBe(false);
    expect(headMovedPast(undefined, 'a')).toBe(false);
    expect(headMovedPast('b', null)).toBe(false);
  });
});
