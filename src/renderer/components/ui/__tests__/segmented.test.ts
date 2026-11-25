import { describe, expect, it } from 'vitest';
import { fitDensity, segmentTip } from '../Segmented';

describe('fitDensity', () => {
  const needs = [300, 260, 230];

  it('keeps the counts while the full row fits', () => {
    expect(fitDensity(300, needs)).toBe('full');
    expect(fitDensity(400, needs)).toBe('full');
  });

  it('drops the counts, then tightens, then truncates', () => {
    expect(fitDensity(299, needs)).toBe('uncounted');
    expect(fitDensity(259, needs)).toBe('tight');
    expect(fitDensity(229, needs)).toBe('truncated');
  });

  it('allows half a pixel of rounding', () => {
    expect(fitDensity(299.6, needs)).toBe('full');
  });
});

describe('segmentTip', () => {
  it('is the title while the count shows', () => {
    expect(segmentTip({ label: 'Files', count: 7 }, true)).toBeUndefined();
    expect(segmentTip({ label: 'Files', count: 7, title: 'PR files' }, true)).toBe('PR files');
  });

  it('carries the count once the badge is gone', () => {
    expect(segmentTip({ label: 'Files', count: 7 }, false)).toBe('Files: 7');
    expect(segmentTip({ label: 'Files', count: 7, title: 'PR files' }, false)).toBe('PR files (7)');
    expect(segmentTip({ label: 'History' }, false)).toBeUndefined();
  });
});
