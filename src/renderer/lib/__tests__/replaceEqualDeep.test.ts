import { describe, expect, it } from 'vitest';
import { replaceEqualDeep } from '../replaceEqualDeep';

describe('replaceEqualDeep', () => {
  it('returns prev when next is deeply equal', () => {
    const prev = { a: { state: 'idle', tool: { label: 'Read' } }, b: [1, 2] };
    const next = structuredClone(prev);
    expect(replaceEqualDeep(prev, next)).toBe(prev);
  });

  it('keeps unchanged entries and replaces the changed one', () => {
    const prev = { t1: { state: 'idle' }, t2: { state: 'busy', tool: { label: 'Read' } } };
    const next = { t1: { state: 'idle' }, t2: { state: 'busy', tool: { label: 'Edit' } } };
    const out = replaceEqualDeep(prev, next);
    expect(out).not.toBe(prev);
    expect(out).toEqual(next);
    expect(out.t1).toBe(prev.t1);
    expect(out.t2).not.toBe(prev.t2);
  });

  it('sees added, removed and undefined-valued keys as changes', () => {
    const prev: Record<string, unknown> = { a: 1 };
    expect(replaceEqualDeep(prev, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    expect(replaceEqualDeep({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    const swapped = replaceEqualDeep<Record<string, unknown>>({ a: 1 }, { b: undefined });
    expect(swapped).toEqual({ b: undefined });
    expect('a' in swapped).toBe(false);
  });

  it('shares array items and treats a length change as a change', () => {
    const prev = [{ n: 1 }, { n: 2 }];
    const out = replaceEqualDeep(prev, [{ n: 1 }, { n: 3 }]);
    expect(out[0]).toBe(prev[0]);
    expect(out).toEqual([{ n: 1 }, { n: 3 }]);
    expect(replaceEqualDeep(prev, [{ n: 1 }])).toEqual([{ n: 1 }]);
  });

  it('takes next whole when the kinds differ', () => {
    const next = { a: 1 };
    expect(replaceEqualDeep([1], next)).toBe(next);
    expect(replaceEqualDeep(undefined, next)).toBe(next);
    const set = new Set([1]);
    expect(replaceEqualDeep(new Set([1]), set)).toBe(set);
  });
});
