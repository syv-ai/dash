import { CircleCheck, CircleEllipsis, CircleMinus, CircleX } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { checkLook, sharedPrState } from '../prStatusColors';

describe('checkLook', () => {
  it('says each state with its own glyph', () => {
    expect(checkLook('passing').icon).toBe(CircleCheck);
    expect(checkLook('failing').icon).toBe(CircleX);
    expect(checkLook('pending').icon).toBe(CircleEllipsis);
    expect(checkLook('skipped').icon).toBe(CircleMinus);
  });

  it('colours passing green, failing red, running amber and skipped neutral', () => {
    expect(checkLook('passing').tone).toBe('text-state-done');
    expect(checkLook('failing').tone).toBe('text-state-fail');
    expect(checkLook('pending').tone).toBe('text-state-work');
    expect(checkLook('skipped').tone).toBe('text-icon');
  });

  it('pulses only while running', () => {
    expect(checkLook('pending').pulse).toBe('pr-ci-running');
    for (const s of ['passing', 'failing', 'skipped'] as const) expect(checkLook(s).pulse).toBe('');
  });
});

describe('sharedPrState', () => {
  const open = { state: 'open' as const, draft: false };
  const draft = { state: 'open' as const, draft: true };
  const merged = { state: 'merged' as const };

  it('is the state every PR shows alike', () => {
    expect(sharedPrState([open, open])).toBe('open');
    expect(sharedPrState([draft, draft])).toBe('draft');
    expect(sharedPrState([merged])).toBe('merged');
  });

  it('counts a draft as draft, not open', () => {
    expect(sharedPrState([open, draft])).toBeNull();
  });

  it('is null for a mixed or empty list', () => {
    expect(sharedPrState([open, merged])).toBeNull();
    expect(sharedPrState([])).toBeNull();
  });
});
