import { describe, it, expect } from 'vitest';
import { leadingIndentPx } from '../indentOffset';

describe('leadingIndentPx', () => {
  it('counts leading spaces at the space width', () => {
    expect(leadingIndentPx('    return x;', 4, 7.5)).toBe(30);
    expect(leadingIndentPx('code', 4, 7.5)).toBe(0);
  });

  it('takes a tab to the next tab stop', () => {
    expect(leadingIndentPx('\tx', 4, 8)).toBe(32);
    expect(leadingIndentPx('  \tx', 4, 8)).toBe(32);
    expect(leadingIndentPx('\t  x', 2, 8)).toBe(32);
  });

  it('gives 0 for a blank or whitespace-only line', () => {
    expect(leadingIndentPx('', 4, 8)).toBe(0);
    expect(leadingIndentPx('   \t ', 4, 8)).toBe(0);
  });
});
