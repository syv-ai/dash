import { describe, expect, it } from 'vitest';
import { framesSettled } from '../framesSettled';

describe('framesSettled', () => {
  it('waits for two on-time frames in a row', () => {
    expect(framesSettled([0])).toBe(false);
    expect(framesSettled([0, 16])).toBe(false);
    expect(framesSettled([0, 16, 33])).toBe(true);
  });

  it('starts over after a long frame', () => {
    expect(framesSettled([0, 16, 90, 106])).toBe(false);
    expect(framesSettled([0, 16, 90, 106, 122])).toBe(true);
  });
});
