import { describe, expect, it } from 'vitest';
import { FILES_TOP_ROW_COMFORT_PX as comfort, fitFilesTopRow } from '../FilesTopRow';

describe('fitFilesTopRow', () => {
  // The least row: "↑3 ↓1", the gap and "All files", padding included.
  const needs = [170];

  it('shows both while the least row fits with room to spare', () => {
    expect(fitFilesTopRow(170 + comfort, needs)).toBe('both');
    expect(fitFilesTopRow(400, needs)).toBe('both');
  });

  it('hides the end, never letting it overlap the start, once they would touch', () => {
    expect(fitFilesTopRow(170 + comfort - 1, needs)).toBe('start');
    expect(fitFilesTopRow(170, needs)).toBe('start');
  });

  it('keeps the start alone before measuring', () => {
    expect(fitFilesTopRow(400, [])).toBe('start');
  });
});
