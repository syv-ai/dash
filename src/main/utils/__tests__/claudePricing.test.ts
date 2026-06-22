import { describe, it, expect } from 'vitest';
import { computeCostUsd, resolveModelFamily } from '../claudePricing';

describe('resolveModelFamily', () => {
  it('maps opus 4.x ids to opus', () => {
    expect(resolveModelFamily('claude-opus-4-8')).toBe('opus');
    expect(resolveModelFamily('claude-opus-4-7')).toBe('opus');
    expect(resolveModelFamily('claude-opus-4')).toBe('opus');
  });

  it('maps sonnet 4.x ids to sonnet', () => {
    expect(resolveModelFamily('claude-sonnet-4-6')).toBe('sonnet');
    expect(resolveModelFamily('claude-sonnet-4-5-20250929')).toBe('sonnet');
  });

  it('maps haiku 4.x ids to haiku', () => {
    expect(resolveModelFamily('claude-haiku-4-5-20251001')).toBe('haiku');
  });

  it('falls back to sonnet for unknown ids', () => {
    expect(resolveModelFamily('claude-future-9-0')).toBe('sonnet');
    expect(resolveModelFamily(undefined)).toBe('sonnet');
  });
});

describe('computeCostUsd', () => {
  it('computes opus 4.x cost: 15/MTok input, 75/MTok output, 1.5/MTok cache-read', () => {
    const cost = computeCostUsd(
      { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 },
      'claude-opus-4-7',
    );
    expect(cost).toBeCloseTo(15 + 75 + 1.5, 6);
  });

  it('computes sonnet 4.x cost: 3/MTok input, 15/MTok output, 0.3/MTok cache-read', () => {
    const cost = computeCostUsd(
      { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 },
      'claude-sonnet-4-6',
    );
    expect(cost).toBeCloseTo(3 + 15 + 0.3, 6);
  });

  it('handles missing usage fields as 0', () => {
    expect(computeCostUsd({ input_tokens: 0, output_tokens: 0 }, 'claude-opus-4-7')).toBe(0);
    expect(computeCostUsd(undefined, 'claude-opus-4-7')).toBe(0);
  });

  it('includes cache-creation tokens when present (priced as input × 1.25)', () => {
    const cost = computeCostUsd(
      { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 },
      'claude-sonnet-4-6',
    );
    expect(cost).toBeCloseTo(3 * 1.25, 6);
  });
});
