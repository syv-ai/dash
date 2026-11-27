import { describe, expect, it } from 'vitest';
import { healthLevel, memoryWarningDefaultGb, type MemoryPressure } from '../systemHealth';

const level = (totalBytes: number, pressure: MemoryPressure | null) =>
  healthLevel({ totalBytes, thresholdBytes: 1000, pressure });

describe('healthLevel', () => {
  it('is ok under the threshold with no pressure', () => {
    expect(level(999, 'normal')).toBe('ok');
    expect(level(0, null)).toBe('ok');
  });

  it('warns at or past the threshold', () => {
    expect(level(1000, 'normal')).toBe('warn');
    expect(level(5000, null)).toBe('warn');
  });

  it('warns under macOS warn pressure, even under the threshold', () => {
    expect(level(10, 'warn')).toBe('warn');
  });

  it('is critical under critical pressure, wherever usage is', () => {
    expect(level(10, 'critical')).toBe('critical');
    expect(level(5000, 'critical')).toBe('critical');
  });
});

describe('memoryWarningDefaultGb', () => {
  it('is 6 GB for macOS footprint and stays 8 GB where RSS or working set is measured', () => {
    expect(memoryWarningDefaultGb(true)).toBe(6);
    expect(memoryWarningDefaultGb(false)).toBe(8);
  });
});
