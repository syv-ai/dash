import { describe, it, expect } from 'vitest';
import { commentsReducer, initialCommentsState } from '../commentsReducer';
import type { DiffComment } from '../types';

const TASK = 'task-1';
function c(over: Partial<DiffComment>): DiffComment {
  return {
    id: 'c1',
    taskId: TASK,
    filePath: 'src/foo.ts',
    startLine: 10,
    endLine: 12,
    text: 'fix this',
    sent: false,
    createdAt: '2026-06-03T00:00:00Z',
    updatedAt: '2026-06-03T00:00:00Z',
    ...over,
  };
}

describe('commentsReducer', () => {
  it('hydrate replaces the full map keyed by filePath', () => {
    const next = commentsReducer(initialCommentsState(), {
      type: 'hydrate',
      comments: [c({ id: 'a' }), c({ id: 'b', filePath: 'src/bar.ts' })],
    });
    expect(next.byFile['src/foo.ts']).toHaveLength(1);
    expect(next.byFile['src/bar.ts']).toHaveLength(1);
  });

  it('upsert inserts a new comment in the right file bucket', () => {
    const state = commentsReducer(initialCommentsState(), { type: 'hydrate', comments: [] });
    const next = commentsReducer(state, { type: 'upsert', comment: c({ id: 'x' }) });
    expect(next.byFile['src/foo.ts']).toHaveLength(1);
    expect(next.byFile['src/foo.ts']![0]!.id).toBe('x');
  });

  it('upsert replaces an existing comment in place', () => {
    const initial = commentsReducer(initialCommentsState(), {
      type: 'hydrate',
      comments: [c({ id: 'a', text: 'old' })],
    });
    const next = commentsReducer(initial, {
      type: 'upsert',
      comment: c({ id: 'a', text: 'new' }),
    });
    expect(next.byFile['src/foo.ts']).toHaveLength(1);
    expect(next.byFile['src/foo.ts']![0]!.text).toBe('new');
  });

  it('upsert moves a comment when its filePath changes', () => {
    const initial = commentsReducer(initialCommentsState(), {
      type: 'hydrate',
      comments: [c({ id: 'a', filePath: 'src/foo.ts' })],
    });
    const next = commentsReducer(initial, {
      type: 'upsert',
      comment: c({ id: 'a', filePath: 'src/bar.ts' }),
    });
    expect(next.byFile['src/foo.ts']).toBeUndefined();
    expect(next.byFile['src/bar.ts']).toHaveLength(1);
  });

  it('remove drops the comment and clears empty file buckets', () => {
    const initial = commentsReducer(initialCommentsState(), {
      type: 'hydrate',
      comments: [c({ id: 'a' })],
    });
    const next = commentsReducer(initial, { type: 'remove', id: 'a' });
    expect(next.byFile['src/foo.ts']).toBeUndefined();
  });

  it('markSent flips multiple ids to sent=true', () => {
    const initial = commentsReducer(initialCommentsState(), {
      type: 'hydrate',
      comments: [c({ id: 'a' }), c({ id: 'b' })],
    });
    const next = commentsReducer(initial, { type: 'markSent', ids: ['a', 'b'] });
    expect(next.byFile['src/foo.ts']!.every((c) => c.sent)).toBe(true);
  });

  it('markUnsent flips one id back to sent=false', () => {
    const initial = commentsReducer(initialCommentsState(), {
      type: 'hydrate',
      comments: [c({ id: 'a', sent: true })],
    });
    const next = commentsReducer(initial, { type: 'markUnsent', id: 'a' });
    expect(next.byFile['src/foo.ts']![0]!.sent).toBe(false);
  });

  it('snapshotRanges updates startLine/endLine for matched ids', () => {
    const initial = commentsReducer(initialCommentsState(), {
      type: 'hydrate',
      comments: [c({ id: 'a', startLine: 10, endLine: 12 })],
    });
    const next = commentsReducer(initial, {
      type: 'snapshotRanges',
      filePath: 'src/foo.ts',
      snapshots: [{ id: 'a', startLine: 20, endLine: 22 }],
    });
    expect(next.byFile['src/foo.ts']![0]!.startLine).toBe(20);
    expect(next.byFile['src/foo.ts']![0]!.endLine).toBe(22);
  });
});
