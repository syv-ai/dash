import { describe, it, expect } from 'vitest';
import { assignShades } from '../shadeAssignment';
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
    viewScope: 'live',
    createdAt: '2026-06-05T00:00:00Z',
    updatedAt: '2026-06-05T00:00:00Z',
    ...over,
  };
}

describe('assignShades', () => {
  it('returns empty map for no comments', () => {
    expect(assignShades([])).toEqual(new Map());
  });

  it('assigns shade 1 to a single comment', () => {
    const m = assignShades([c({ id: 'a' })]);
    expect(m.get('a')).toBe(1);
  });

  it('assigns shade 1 to non-overlapping comments', () => {
    const m = assignShades([
      c({ id: 'a', startLine: 1, endLine: 5 }),
      c({ id: 'b', startLine: 10, endLine: 15 }),
    ]);
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(1);
  });

  it('assigns shade 2 to a partial-overlap neighbor', () => {
    const m = assignShades([
      c({ id: 'a', startLine: 1, endLine: 5 }),
      c({ id: 'b', startLine: 4, endLine: 8 }),
    ]);
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(2);
  });

  it('reuses shade 1 across non-overlapping partial-overlap pairs', () => {
    const m = assignShades([
      c({ id: 'a', startLine: 1, endLine: 5 }),
      c({ id: 'b', startLine: 4, endLine: 8 }), // overlaps a
      c({ id: 'c', startLine: 20, endLine: 25 }),
      c({ id: 'd', startLine: 23, endLine: 28 }), // overlaps c only
    ]);
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(2);
    expect(m.get('c')).toBe(1);
    expect(m.get('d')).toBe(2);
  });

  it('treats identical ranges as same-anchor (NOT overlap) — same shade', () => {
    const m = assignShades([
      c({ id: 'a', startLine: 10, endLine: 10 }),
      c({ id: 'b', startLine: 10, endLine: 10 }),
    ]);
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(1);
  });

  it('handles stable ordering — sort by startLine then by id', () => {
    // 'z' added before 'a' in the input array, but 'a' starts earlier
    const m = assignShades([
      c({ id: 'z', startLine: 5, endLine: 9 }),
      c({ id: 'a', startLine: 1, endLine: 6 }),
    ]);
    expect(m.get('a')).toBe(1);
    expect(m.get('z')).toBe(2);
  });

  it('3-way mutual overlap degrades (one comment shares a shade with another)', () => {
    // Documented limitation: 2-color palette cannot cleanly distinguish three
    // mutually-overlapping comments.
    const m = assignShades([
      c({ id: 'a', startLine: 1, endLine: 5 }),
      c({ id: 'b', startLine: 3, endLine: 7 }),
      c({ id: 'c', startLine: 4, endLine: 9 }),
    ]);
    const shades = ['a', 'b', 'c'].map((id) => m.get(id));
    expect(new Set(shades).size).toBeLessThanOrEqual(2);
  });
});
