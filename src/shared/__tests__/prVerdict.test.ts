import { describe, expect, it } from 'vitest';
import type { PrReviewer } from '../types';
import { reviewVerdict } from '../prVerdict';

describe('reviewVerdict', () => {
  const r = (state: PrReviewer['state'], o: Partial<PrReviewer> = {}): PrReviewer => ({
    name: state,
    url: null,
    state,
    ...o,
  });
  it('says changes requested when anyone asked for them (an ADO rejection or wait too)', () => {
    expect(reviewVerdict([r('approved'), r('changes_requested')])).toBe('changes_requested');
    expect(reviewVerdict([r('rejected')])).toBe('changes_requested');
    expect(reviewVerdict([r('waiting')])).toBe('changes_requested');
  });
  it('is pending while a required review is to come, approved once in', () => {
    expect(reviewVerdict([r('approved'), r('pending', { required: true })])).toBe('pending');
    expect(reviewVerdict([r('approved_with_suggestions'), r('pending')])).toBe('approved');
  });
  it('leaves out those who declined, and says nothing with no one asked', () => {
    expect(reviewVerdict([r('approved'), r('changes_requested', { declined: true })])).toBe(
      'approved',
    );
    expect(reviewVerdict([r('pending')])).toBe('pending');
    expect(reviewVerdict([r('commented')])).toBeNull();
    expect(reviewVerdict([])).toBeNull();
  });
});
