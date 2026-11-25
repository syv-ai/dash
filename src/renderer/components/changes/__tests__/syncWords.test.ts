import { describe, expect, it } from 'vitest';
import { fitSync, SYNC_COMFORT_PX as comfort, syncSentence, syncWords } from '../SyncStatus';

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

describe('syncSentence', () => {
  it('reads both sides, the commits named once', () => {
    expect(syncSentence(213, 6)).toBe('213 commits ahead, 6 behind');
  });

  it('leaves a zero side out', () => {
    expect(syncSentence(0, 1)).toBe('1 commit behind');
    expect(syncSentence(2, 0)).toBe('2 commits ahead');
  });
});

describe('fitSync', () => {
  it('keeps the words while they fit with room to spare', () => {
    expect(fitSync(180 + comfort, [180])).toBe('words');
  });

  it('turns to arrows before the words run up against the row', () => {
    expect(fitSync(180 + comfort - 1, [180])).toBe('arrows');
    expect(fitSync(180, [180])).toBe('arrows');
  });

  it('starts on arrows, never overflowing, until measured', () => {
    expect(fitSync(1000, [])).toBe('arrows');
  });
});
