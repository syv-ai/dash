import { describe, it, expect } from 'vitest';
import { formatTokens, formatCost } from '../formatTokens';

describe('formatTokens', () => {
  it('formats zero as "0"', () => {
    expect(formatTokens(0)).toBe('0');
  });

  it('formats <1000 as plain integer', () => {
    expect(formatTokens(42)).toBe('42');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands with one decimal + k suffix', () => {
    expect(formatTokens(1_000)).toBe('1.0k');
    expect(formatTokens(12_345)).toBe('12.3k');
  });

  it('formats millions with one decimal + M suffix', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(2_400_000)).toBe('2.4M');
    expect(formatTokens(18_000_000)).toBe('18.0M');
  });
});

describe('formatCost', () => {
  it('formats zero as "$0.00"', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('formats small amounts to 2 decimals', () => {
    expect(formatCost(0.123)).toBe('$0.12');
    expect(formatCost(4.32)).toBe('$4.32');
    expect(formatCost(63.1)).toBe('$63.10');
  });

  it('formats >=100 without cents', () => {
    expect(formatCost(123.45)).toBe('$123');
    expect(formatCost(1500)).toBe('$1500');
  });
});
