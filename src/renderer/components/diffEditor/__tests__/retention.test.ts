import { describe, expect, it } from 'vitest';
import { parkedToRelease, retainedOnUnmount } from '../retention';

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

describe('parkedToRelease', () => {
  const parked = new Map([
    ['tabs:t1', '/wt/a'],
    ['tabs:t2', '/wt/b'],
  ]);
  const open = { target: {}, hidden: false };

  it('releases the holders of a folder whose editor went away (closed, archived, deleted)', () => {
    expect(parkedToRelease(parked, { '/wt/a': open, '/wt/b': open }, { '/wt/b': open })).toEqual([
      'tabs:t1',
    ]);
  });

  it('keeps holders whose folder still has its editor', () => {
    expect(parkedToRelease(parked, { '/wt/a': open }, { '/wt/a': open })).toEqual([]);
  });

  it('ignores a folder that had no editor before', () => {
    expect(parkedToRelease(parked, {}, {})).toEqual([]);
  });
});
