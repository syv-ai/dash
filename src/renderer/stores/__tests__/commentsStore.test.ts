import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { DiffComment } from '../../../shared/types';

const cmt = (over: Partial<DiffComment> = {}): DiffComment => ({
  id: over.id ?? 'c1',
  taskId: over.taskId ?? 't1',
  filePath: over.filePath ?? 'a.ts',
  startLine: over.startLine ?? 1,
  endLine: over.endLine ?? 2,
  text: over.text ?? 'hello',
  sent: over.sent ?? false,
  createdAt: over.createdAt ?? '2026-01-01T00:00:00Z',
  updatedAt: over.updatedAt ?? '2026-01-01T00:00:00Z',
});

async function freshStore() {
  vi.resetModules();
  const mod = await import('../commentsStore');
  return mod.useCommentsStore;
}

describe('commentsStore', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('hydrates byFile from diffComments:list, grouped + sorted by startLine', async () => {
    api.diffCommentsList = vi.fn(() =>
      Promise.resolve({
        success: true,
        data: [cmt({ id: 'b', startLine: 5 }), cmt({ id: 'a', startLine: 2 })],
      }),
    );
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');
    const byFile = useCommentsStore.getState().byFile;
    expect(byFile['a.ts']!.map((c) => c.id)).toEqual(['a', 'b']);
    expect(useCommentsStore.getState().isReady).toBe(true);
    expect(useCommentsStore.getState().taskId).toBe('t1');
  });

  it('addComment optimistically inserts and persists via upsert', async () => {
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');
    const created = useCommentsStore
      .getState()
      .addComment({ filePath: 'a.ts', startLine: 3, endLine: 3, text: 'x' });
    expect(created).not.toBeNull();
    expect(useCommentsStore.getState().byFile['a.ts']).toHaveLength(1);
    expect(api.diffCommentsUpsert).toHaveBeenCalledTimes(1);
  });

  it('mutators no-op when taskId is null (disabled)', async () => {
    const useCommentsStore = await freshStore();
    // never loadForTask → taskId null
    const created = useCommentsStore
      .getState()
      .addComment({ filePath: 'a.ts', startLine: 1, endLine: 1, text: 'x' });
    expect(created).toBeNull();
    expect(useCommentsStore.getState().disabled).toBe(true);
    expect(api.diffCommentsUpsert).not.toHaveBeenCalled();
  });

  it('markSent flips sent and persists sent=true for each id', async () => {
    api.diffCommentsList = vi.fn(() =>
      Promise.resolve({ success: true, data: [cmt({ id: 'a' })] }),
    );
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');
    useCommentsStore.getState().markSent(['a']);
    expect(useCommentsStore.getState().byFile['a.ts']![0]!.sent).toBe(true);
    expect(api.diffCommentsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', sent: true }),
    );
  });

  it('remove deletes locally and via IPC', async () => {
    api.diffCommentsList = vi.fn(() =>
      Promise.resolve({ success: true, data: [cmt({ id: 'a' })] }),
    );
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');
    useCommentsStore.getState().remove('a');
    expect(useCommentsStore.getState().byFile['a.ts']).toBeUndefined();
    expect(api.diffCommentsDelete).toHaveBeenCalledWith({ id: 'a' });
  });

  it('snapshotRanges patches start/end and persists', async () => {
    api.diffCommentsList = vi.fn(() =>
      Promise.resolve({ success: true, data: [cmt({ id: 'a', startLine: 1, endLine: 1 })] }),
    );
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');
    useCommentsStore.getState().snapshotRanges('a.ts', [{ id: 'a', startLine: 10, endLine: 12 }]);
    expect(useCommentsStore.getState().byFile['a.ts']![0]!.startLine).toBe(10);
    expect(api.diffCommentsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', startLine: 10, endLine: 12 }),
    );
  });
});
