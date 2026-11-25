import { describe, expect, it } from 'vitest';
import { syncWords } from '../SyncStatus';

describe('syncWords', () => {
  it('names the commits once, on the first part', () => {
    expect(syncWords(3, 2)).toEqual({ ahead: 'commits ahead', behind: 'behind' });
  });

  it('names them on behind when nothing is ahead', () => {
    expect(syncWords(0, 2).behind).toBe('commits behind');
  });

  it('says commit for one', () => {
    expect(syncWords(1, 0).ahead).toBe('commit ahead');
    expect(syncWords(0, 1).behind).toBe('commit behind');
  });
});
