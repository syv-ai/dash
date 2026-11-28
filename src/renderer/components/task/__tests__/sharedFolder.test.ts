import { describe, expect, it } from 'vitest';
import { sharedFolderTooltip, sharedFolderWarning } from '../sharedFolder';

describe('sharedFolderWarning', () => {
  it('names the one task already there, or counts several, and says nothing for none', () => {
    expect(sharedFolderWarning([])).toBeNull();
    expect(sharedFolderWarning(['Fix login'])).toBe(
      '"Fix login" already works in this folder. Tasks here edit the same files, so their changes can collide.',
    );
    expect(sharedFolderWarning(['a', 'b', 'c'])).toMatch(/^3 tasks already work in this folder\./);
  });
});

describe('sharedFolderTooltip', () => {
  it('names the first task it shares with and counts the rest', () => {
    expect(sharedFolderTooltip([])).toBeNull();
    expect(sharedFolderTooltip(['b'])).toBe(
      'Shares its folder with "b": their changes can collide',
    );
    expect(sharedFolderTooltip(['b', 'c'])).toBe(
      'Shares its folder with "b" and 1 more: their changes can collide',
    );
  });
});
