import { describe, it, expect } from 'vitest';
import { fitFolderTabs } from '../FolderTabs';

describe('fitFolderTabs', () => {
  // Natural widths: inset and counts, counts alone, labels alone.
  const needs = [260, 248, 207];

  it('keeps the inset and counts while they fit', () => {
    expect(fitFolderTabs(260, needs)).toBe('full');
  });

  it('gives up the corner inset before anything else', () => {
    expect(fitFolderTabs(259, needs)).toBe('flush');
    expect(fitFolderTabs(248, needs)).toBe('flush');
  });

  it('then drops the counts, never the labels', () => {
    expect(fitFolderTabs(247, needs)).toBe('uncounted');
    expect(fitFolderTabs(100, needs)).toBe('uncounted');
  });
});
