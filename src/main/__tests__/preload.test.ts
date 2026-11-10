import { describe, it, expect, vi, beforeAll } from 'vitest';
import { EventEmitter } from 'events';

// A stub ipcRenderer (an EventEmitter, as the real one is) and a contextBridge
// that captures the exposed API, so the preload's listeners run in plain node.
const { ipc, exposed } = vi.hoisted(() => ({
  ipc: { current: null as unknown as import('events').EventEmitter },
  exposed: {} as Record<string, unknown>,
}));

vi.mock('electron', () => {
  ipc.current = new EventEmitter();
  return {
    ipcRenderer: ipc.current,
    contextBridge: {
      exposeInMainWorld: (key: string, api: unknown) => {
        exposed[key] = api;
      },
    },
    webUtils: { getPathForFile: () => '' },
  };
});

type Unsub = () => void;
const api = () =>
  exposed.electronAPI as {
    onTasksChanged: (cb: (d: { projectId: string }) => void) => Unsub;
    onProjectsChanged: (cb: () => void) => Unsub;
    onPtyData: (id: string, cb: (d: string) => void) => Unsub;
  };

describe('preload listen', () => {
  beforeAll(async () => {
    await import('../preload');
  });

  it('forwards the payload without the IPC event, and unsubscribes', () => {
    const cb = vi.fn();
    const off = api().onTasksChanged(cb);
    ipc.current.emit('tasks:changed', {}, { projectId: 'p1' });
    expect(cb).toHaveBeenCalledWith({ projectId: 'p1' });
    off();
    ipc.current.emit('tasks:changed', {}, { projectId: 'p2' });
    expect(cb).toHaveBeenCalledOnce();
    expect(ipc.current.listenerCount('tasks:changed')).toBe(0);
  });

  it('works for payload-less channels', () => {
    const cb = vi.fn();
    const off = api().onProjectsChanged(cb);
    ipc.current.emit('projects:changed', {});
    expect(cb).toHaveBeenCalledOnce();
    off();
  });

  it('keeps per-id channels separate', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = api().onPtyData('a', a);
    const offB = api().onPtyData('b', b);
    ipc.current.emit('pty:data:a', {}, 'hello');
    expect(a).toHaveBeenCalledWith('hello');
    expect(b).not.toHaveBeenCalled();
    offA();
    offB();
    expect(ipc.current.listenerCount('pty:data:a')).toBe(0);
  });
});
