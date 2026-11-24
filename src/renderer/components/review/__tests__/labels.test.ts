import { describe, expect, it } from 'vitest';
import {
  changedFilesLine,
  communicationCounts,
  mergeVerb,
  prDateTime,
  threadsLine,
} from '../labels';

describe('changedFilesLine', () => {
  it('counts the files and totals their lines', () => {
    const f = (additions: number, deletions: number) => ({ additions, deletions });
    expect(changedFilesLine([f(3, 1), f(10, 0)])).toBe('2 changed files, +13 −1 total');
    expect(changedFilesLine([f(1, 1)])).toBe('1 changed file, +1 −1 total');
  });
});

describe('threadsLine', () => {
  it('says how many threads and how many are resolved', () => {
    expect(threadsLine([{ resolved: true }, { resolved: false }])).toBe(
      '2 comment threads (1 of 2 resolved)',
    );
    expect(threadsLine([])).toBeNull();
  });
});

describe('prDateTime', () => {
  it('reads an ISO date in the given clock, and nothing for a bad one', () => {
    expect(prDateTime('2026-11-26T09:00:00Z', { locale: 'en-GB', timeZone: 'UTC' })).toBe(
      'Thu 26/11/2026, 09:00',
    );
    expect(prDateTime('')).toBe('');
  });
});

describe('communicationCounts', () => {
  it('lists the counts there are', () => {
    expect(communicationCounts({ open: 5, drafts: 2, notes: 1 })).toBe(
      '5 open · 2 drafts · 1 note',
    );
    expect(communicationCounts({ open: 0, drafts: 1, notes: 0 })).toBe('1 draft');
    expect(communicationCounts({ open: 0, drafts: 0, notes: 0 })).toBe('');
  });
});

describe('mergeVerb', () => {
  it('reads by state', () => {
    expect(mergeVerb('open')).toBe('wants to merge');
    expect(mergeVerb('draft')).toBe('wants to merge');
    expect(mergeVerb('merged')).toBe('merged');
    expect(mergeVerb('closed')).toBe('wanted to merge');
  });
});
