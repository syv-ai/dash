import { describe, expect, it } from 'vitest';
import { retainedOnUnmount } from '../retention';

const open = ['/wt/a/x.ts', '/wt/a/y.ts', '/wt/a/z.ts'];
const dirty = new Set(['/wt/a/x.ts', '/wt/a/z.ts']);
const isDirty = (p: string) => dirty.has(p);

describe('retainedOnUnmount', () => {
  it('keeps the unsaved files of an editor left open (a task switched away from)', () => {
    expect(retainedOnUnmount(open, false, isDirty)).toEqual(['/wt/a/x.ts', '/wt/a/z.ts']);
  });

  it('lets clean files go: they reload from disk on return', () => {
    expect(retainedOnUnmount(open, false, () => false)).toEqual([]);
  });

  it('keeps nothing once the editor was closed (its edits discarded)', () => {
    expect(retainedOnUnmount(open, true, isDirty)).toEqual([]);
  });
});
