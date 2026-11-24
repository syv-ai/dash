import { describe, expect, it } from 'vitest';
import { onChangeCount, pickSegment, segmentOnExpand } from '../sidebarState';

describe('pickSegment', () => {
  const pick = (
    current: 'changes' | 'files' | 'history' | 'details',
    next: 'changes' | 'files' | 'history',
    expanded: boolean,
    changeCount: number | null = 3,
  ) => pickSegment({ current, next, expanded, changeCount });

  it('goes narrow when the expanded view is picked again', () => {
    expect(pick('files', 'files', true)).toBe('narrow');
    expect(pick('changes', 'changes', true)).toBe('narrow');
  });

  it('does nothing when the narrow view is picked again (never collapses)', () => {
    expect(pick('history', 'history', false)).toBe('none');
    expect(pick('files', 'files', false)).toBe('none');
  });

  it('shows another view without changing the state', () => {
    expect(pick('changes', 'files', false)).toBe('select');
    expect(pick('files', 'history', true)).toBe('select');
    expect(pick('files', 'changes', true)).toBe('select');
  });

  it('shows the view picked from the details', () => {
    expect(pick('details', 'files', true)).toBe('select');
  });

  it('goes narrow to an empty Changes', () => {
    expect(pick('files', 'changes', true, 0)).toBe('narrow');
    expect(pick('files', 'changes', false, 0)).toBe('select');
  });

  it('keeps Changes expanded while the status loads', () => {
    expect(pick('files', 'changes', true, null)).toBe('select');
  });
});

describe('onChangeCount', () => {
  const base = { segment: 'changes' as const, expanded: true };

  it('narrows when Changes empties while it shows expanded', () => {
    expect(onChangeCount({ ...base, before: 2, now: 0 })).toBe('narrow');
  });

  it('shows Files when the status loads empty (a task switched back to)', () => {
    expect(onChangeCount({ ...base, before: null, now: 0 })).toBe('files');
  });

  it('reacts to the change only, not to it staying empty', () => {
    expect(onChangeCount({ ...base, before: 0, now: 0 })).toBeNull();
  });

  it('never expands again as changes appear', () => {
    expect(onChangeCount({ ...base, before: 0, now: 2 })).toBeNull();
  });

  it('leaves the other views and a narrow sidebar alone', () => {
    expect(onChangeCount({ ...base, segment: 'files', before: 2, now: 0 })).toBeNull();
    expect(onChangeCount({ ...base, expanded: false, before: 2, now: 0 })).toBeNull();
  });
});

describe('segmentOnExpand', () => {
  it('shows Files when a file opens on an empty Changes', () => {
    expect(segmentOnExpand('changes', 0)).toBe('files');
  });

  it('keeps Changes with changes to show, and any other view', () => {
    expect(segmentOnExpand('changes', 2)).toBe('changes');
    expect(segmentOnExpand('changes', null)).toBe('changes');
    expect(segmentOnExpand('history', 0)).toBe('history');
    expect(segmentOnExpand('details', 0)).toBe('details');
  });
});
