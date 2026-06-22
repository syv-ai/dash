import { describe, it, expect } from 'vitest';
import { getBillionToastContent } from '../billionToast';

describe('getBillionToastContent', () => {
  it('formats title with localized billion count', () => {
    const c = getBillionToastContent(1, 1_000_000_000);
    expect(c.title).toBe('You just passed 1 billion tokens.');
  });

  it('description omits emoji and starts with "About"', () => {
    const c = getBillionToastContent(1, 1_000_000_000);
    expect(c.description.startsWith('About ')).toBe(true);
    // No emoji range in the description text.
    expect(c.description).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('rotates comparison units across consecutive billions', () => {
    const d1 = getBillionToastContent(1, 1_000_000_000).description;
    const d2 = getBillionToastContent(2, 2_000_000_000).description;
    expect(d1).not.toBe(d2);
  });

  it('computes a sane War and Peace count for 1B tokens (~1,278)', () => {
    // 1B tokens × 0.75 = 750M words. 750M / 587K ≈ 1,278.
    const { description } = getBillionToastContent(1, 1_000_000_000);
    expect(description).toMatch(/1,278/);
    expect(description).toContain('War and Peace');
  });

  it('scales with totalTokens, not just the billion index', () => {
    const at1B = getBillionToastContent(1, 1_000_000_000).description;
    const at1_5B = getBillionToastContent(1, 1_500_000_000).description;
    expect(at1B).not.toBe(at1_5B);
  });

  it('never returns "About 0 …"', () => {
    const { description } = getBillionToastContent(1, 1_000_000_000);
    expect(description).not.toMatch(/^About 0 /);
  });

  it('wraps around the comparison list after 8 billions', () => {
    const first = getBillionToastContent(1, 1_000_000_000).description.replace(/[\d,]/g, '');
    const ninth = getBillionToastContent(9, 9_000_000_000).description.replace(/[\d,]/g, '');
    expect(first).toBe(ninth);
  });
});
