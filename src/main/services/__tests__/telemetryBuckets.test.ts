import { describe, expect, it } from 'vitest';
import { countBucket, durationBucket, minutesBucket } from '../telemetryBuckets';

describe('durationBucket', () => {
  it.each([
    [5_000, 'lt_10s'],
    [30_000, '10s_1m'],
    [4 * 60_000, '1m_5m'],
    [10 * 60_000, '5m_15m'],
    [40 * 60_000, '15m_1h'],
    [2 * 3_600_000, 'gt_1h'],
  ])('%i ms → %s', (ms, bucket) => {
    expect(durationBucket(ms)).toBe(bucket);
  });
});

describe('countBucket', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [2, '2_3'],
    [3, '2_3'],
    [4, '4_5'],
    [5, '4_5'],
    [6, '6_10'],
    [10, '6_10'],
    [11, '11_20'],
    [20, '11_20'],
    [21, '21_50'],
    [50, '21_50'],
    [51, 'gt_50'],
  ])('%i → %s', (n, bucket) => {
    expect(countBucket(n)).toBe(bucket);
  });

  it('reads anything below one as none', () => {
    expect(countBucket(-3)).toBe('0');
    expect(countBucket(Number.NaN)).toBe('0');
  });
});

describe('minutesBucket', () => {
  it.each([
    [0, '0'],
    [14, 'lt_15m'],
    [15, '15m_1h'],
    [59, '15m_1h'],
    [60, '1h_2h'],
    [130, '2h_4h'],
    [300, '4h_8h'],
    [480, 'gt_8h'],
  ])('%i min → %s', (m, bucket) => {
    expect(minutesBucket(m)).toBe(bucket);
  });
});
