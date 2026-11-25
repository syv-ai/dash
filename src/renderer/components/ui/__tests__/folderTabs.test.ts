import { describe, it, expect } from 'vitest';
import { fitFolderTabs } from '../FolderTabs';

describe('fitFolderTabs', () => {
  // Natural widths, the corner inset included in both: counts, labels alone.
  const needs = [260, 219];

  it('keeps the counts while they fit', () => {
    expect(fitFolderTabs(260, needs)).toBe('full');
  });

  it('then drops the counts, never the labels or the inset', () => {
    expect(fitFolderTabs(259, needs)).toBe('uncounted');
    expect(fitFolderTabs(100, needs)).toBe('uncounted');
  });
});
