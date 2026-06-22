import { describe, it, expect } from 'vitest';
import { computeRowDecorations, commentIdsAtLine } from '../rowShades';
import type { DiffComment } from '../types';

function c(over: Partial<DiffComment>): DiffComment {
  return {
    id: 'x',
    taskId: 't',
    filePath: 'f.ts',
    startLine: 1,
    endLine: 1,
    text: '',
    sent: false,
    createdAt: '2026-06-05T00:00:00Z',
    updatedAt: '2026-06-05T00:00:00Z',
    ...over,
  };
}

describe('computeRowDecorations', () => {
  it('returns empty array for no comments', () => {
    expect(computeRowDecorations([], new Map())).toEqual([]);
  });

  it('coalesces a single multi-line range into one decoration', () => {
    const cs = [c({ id: 'a', startLine: 10, endLine: 14 })];
    const shades = new Map([['a', 1 as const]]);
    expect(computeRowDecorations(cs, shades)).toEqual([
      { startLine: 10, endLine: 14, signature: '1' },
    ]);
  });

  it('splits a range when an overlapping range starts mid-way', () => {
    // A: 10-14 (shade 1), B: 13-17 (shade 2). Lines 13-14 overlap.
    const cs = [
      c({ id: 'a', startLine: 10, endLine: 14 }),
      c({ id: 'b', startLine: 13, endLine: 17 }),
    ];
    const shades = new Map([
      ['a', 1 as const],
      ['b', 2 as const],
    ]);
    expect(computeRowDecorations(cs, shades)).toEqual([
      { startLine: 10, endLine: 12, signature: '1' },
      { startLine: 13, endLine: 14, signature: '12' },
      { startLine: 15, endLine: 17, signature: '2' },
    ]);
  });

  it('merges same-anchor comments into one decoration (same shade)', () => {
    const cs = [c({ id: 'a', startLine: 5, endLine: 5 }), c({ id: 'b', startLine: 5, endLine: 5 })];
    const shades = new Map([
      ['a', 1 as const],
      ['b', 1 as const],
    ]);
    expect(computeRowDecorations(cs, shades)).toEqual([
      { startLine: 5, endLine: 5, signature: '1' },
    ]);
  });
});

describe('commentIdsAtLine', () => {
  it('returns empty when no comments claim the line', () => {
    expect(commentIdsAtLine([], 10)).toEqual([]);
  });

  it('returns ids of every comment whose range contains the line', () => {
    const cs = [
      c({ id: 'a', startLine: 10, endLine: 14 }),
      c({ id: 'b', startLine: 13, endLine: 17 }),
      c({ id: 'c', startLine: 20, endLine: 25 }),
    ];
    expect(commentIdsAtLine(cs, 13).sort()).toEqual(['a', 'b']);
    expect(commentIdsAtLine(cs, 14).sort()).toEqual(['a', 'b']);
    expect(commentIdsAtLine(cs, 10)).toEqual(['a']);
    expect(commentIdsAtLine(cs, 22)).toEqual(['c']);
  });
});
