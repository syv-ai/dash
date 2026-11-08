import { describe, it, expect } from 'vitest';
import { recordContextLoss, WEBGL_LOSS_WINDOW_MS } from '../webglContextLoss';

describe('recordContextLoss', () => {
  it('reloads after a first and second loss', () => {
    const first = recordContextLoss([], 1_000);
    expect(first).toEqual({ losses: [1_000], fallback: false });
    const second = recordContextLoss(first.losses, 2_000);
    expect(second).toEqual({ losses: [1_000, 2_000], fallback: false });
  });

  it('falls back on the third loss within the window', () => {
    expect(recordContextLoss([1_000, 2_000], 3_000).fallback).toBe(true);
  });

  it('forgets losses older than the window', () => {
    const now = 1_000 + WEBGL_LOSS_WINDOW_MS;
    const result = recordContextLoss([1_000, 2_000], now);
    expect(result).toEqual({ losses: [2_000, now], fallback: false });
  });

  it('keeps reloading when losses are spread out', () => {
    let losses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const result = recordContextLoss(losses, i * WEBGL_LOSS_WINDOW_MS);
      expect(result.fallback).toBe(false);
      losses = result.losses;
    }
  });
});
