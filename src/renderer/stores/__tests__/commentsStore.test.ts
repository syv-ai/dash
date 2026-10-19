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
  viewScope: over.viewScope ?? 'live',
  side: 'RIGHT',
  replyTo: null,
  author: 'user',
  kind: over.kind ?? 'note',
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
      .addComment({ filePath: 'a.ts', startLine: 3, endLine: 3, text: 'x', viewScope: 'live' });
    expect(created).not.toBeNull();
    expect(useCommentsStore.getState().byFile['a.ts']).toHaveLength(1);
    expect(api.diffCommentsUpsert).toHaveBeenCalledTimes(1);
  });

  it('mutators no-op when taskId is null (disabled)', async () => {
    const useCommentsStore = await freshStore();
    // never loadForTask → taskId null
    const created = useCommentsStore
      .getState()
      .addComment({ filePath: 'a.ts', startLine: 1, endLine: 1, text: 'x', viewScope: 'live' });
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

  it('clearSent removes only sent comments and deletes each via IPC', async () => {
    api.diffCommentsList = vi.fn(() =>
      Promise.resolve({
        success: true,
        data: [
          cmt({ id: 'a', sent: true }),
          cmt({ id: 'b', sent: false }),
          cmt({ id: 'c', filePath: 'b.ts', sent: true }),
        ],
      }),
    );
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');
    useCommentsStore.getState().clearSent();
    const byFile = useCommentsStore.getState().byFile;
    expect(byFile['a.ts']!.map((c) => c.id)).toEqual(['b']);
    expect(byFile['b.ts']).toBeUndefined();
    expect(api.diffCommentsDelete).toHaveBeenCalledWith({ id: 'a' });
    expect(api.diffCommentsDelete).toHaveBeenCalledWith({ id: 'c' });
    expect(api.diffCommentsDelete).toHaveBeenCalledTimes(2);
  });

  it('clearSent(scope) only clears sent comments in that scope', async () => {
    api.diffCommentsList = vi.fn(() =>
      Promise.resolve({
        success: true,
        data: [
          cmt({ id: 'a', sent: true, viewScope: 'live' }),
          cmt({ id: 'b', sent: true, viewScope: 'commit:abc' }),
        ],
      }),
    );
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');
    useCommentsStore.getState().clearSent('commit:abc');
    expect(useCommentsStore.getState().byFile['a.ts']!.map((c) => c.id)).toEqual(['a']);
    expect(api.diffCommentsDelete).toHaveBeenCalledWith({ id: 'b' });
    expect(api.diffCommentsDelete).toHaveBeenCalledTimes(1);
  });

  it('clearSent never deletes a PR comment, which still goes to the PR', async () => {
    api.diffCommentsList = vi.fn(() =>
      Promise.resolve({
        success: true,
        data: [
          cmt({ id: 'note', sent: true, viewScope: 'pr:github:4' }),
          cmt({ id: 'comment', sent: true, viewScope: 'pr:github:4', kind: 'comment' }),
        ],
      }),
    );
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');
    useCommentsStore.getState().clearSent();
    expect(useCommentsStore.getState().byFile['a.ts']!.map((c) => c.id)).toEqual(['comment']);
    expect(api.diffCommentsDelete).toHaveBeenCalledTimes(1);
  });

  it("clearNotes(scope) removes that scope's notes, sent or not, and keeps its comments", async () => {
    api.diffCommentsList = vi.fn(() =>
      Promise.resolve({
        success: true,
        data: [
          cmt({ id: 'n1', viewScope: 'pr:github:4' }),
          cmt({ id: 'n2', sent: true, viewScope: 'pr:github:4', startLine: 2 }),
          cmt({ id: 'c', viewScope: 'pr:github:4', kind: 'comment', startLine: 3 }),
          cmt({ id: 'live', startLine: 4 }),
        ],
      }),
    );
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');
    useCommentsStore.getState().clearNotes('pr:github:4');
    expect(useCommentsStore.getState().byFile['a.ts']!.map((c) => c.id)).toEqual(['c', 'live']);
    expect(api.diffCommentsDelete).toHaveBeenCalledTimes(2);
  });

  it('adds a comment when asked, and promotes a note to a comment', async () => {
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');
    const base = { filePath: 'a.ts', startLine: 1, endLine: 1, viewScope: 'pr:github:4' };
    const note = useCommentsStore.getState().addComment({ ...base, text: 'n' })!;
    const comment = useCommentsStore
      .getState()
      .addComment({ ...base, text: 'c', kind: 'comment' })!;
    expect(note.kind).toBe('note');
    expect(comment.kind).toBe('comment');
    useCommentsStore.getState().setKind(note.id, 'comment');
    expect(useCommentsStore.getState().byFile['a.ts']!.every((c) => c.kind === 'comment')).toBe(
      true,
    );
    expect(api.diffCommentsUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: note.id, kind: 'comment' }),
    );
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

  it("reloads in place when main says the loaded task's comments changed", async () => {
    let fire: (d: { taskId: string }) => void = () => {};
    api.onDiffCommentsChanged = vi.fn((cb: (d: { taskId: string }) => void) => {
      fire = cb;
      return () => {};
    });
    api.diffCommentsList = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: [cmt({ id: 'a' })] })
      .mockResolvedValue({
        success: true,
        data: [cmt({ id: 'a' }), cmt({ id: 'agent', startLine: 9 })],
      });
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');

    fire({ taskId: 'other' });
    await Promise.resolve();
    expect(api.diffCommentsList).toHaveBeenCalledTimes(1);

    fire({ taskId: 't1' });
    await vi.waitFor(() =>
      expect(useCommentsStore.getState().byFile['a.ts']!.map((c) => c.id)).toEqual(['a', 'agent']),
    );
  });

  it("addComment keeps a reply draft's thread", async () => {
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');
    const c = useCommentsStore.getState().addComment({
      filePath: 'a.ts',
      startLine: 3,
      endLine: 3,
      text: 'agreed',
      viewScope: 'pr:github:4',
      replyTo: 'T_1',
    });
    expect(c).toMatchObject({ replyTo: 'T_1', author: 'user', side: 'RIGHT' });
    expect(api.diffCommentsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: 'T_1' }),
    );
  });

  it("takes main's answer on who owns a draft after its text is edited", async () => {
    api.diffCommentsList = vi.fn(() =>
      Promise.resolve({ success: true, data: [{ ...cmt({ id: 'a' }), author: 'agent' }] }),
    );
    api.diffCommentsUpsert = vi.fn((c: unknown) =>
      Promise.resolve({ success: true, data: { ...(c as DiffComment), author: 'user' } }),
    );
    const useCommentsStore = await freshStore();
    await useCommentsStore.getState().loadForTask('t1');
    useCommentsStore.getState().updateText('a', 'mine now');
    await vi.waitFor(() =>
      expect(useCommentsStore.getState().byFile['a.ts']![0]!.author).toBe('user'),
    );
  });
});
