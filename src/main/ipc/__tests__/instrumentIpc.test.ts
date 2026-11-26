import { describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
import { instrumentIpcHandlers } from '../instrumentIpc';

type Listener = (event: unknown, ...args: unknown[]) => unknown;

function fakeIpc() {
  const handlers = new Map<string, Listener>();
  const ipc = {
    handle: (channel: string, listener: Listener) => void handlers.set(channel, listener),
  } as unknown as Pick<IpcMain, 'handle'>;
  const sink = { failure: vi.fn(), exception: vi.fn() };
  instrumentIpcHandlers(ipc, sink);
  return { ipc, handlers, sink };
}

describe('instrumentIpcHandlers', () => {
  it('passes a success through and reports nothing', async () => {
    const { ipc, handlers, sink } = fakeIpc();
    ipc.handle('git:status', () => ({ success: true, data: 1 }));
    expect(await handlers.get('git:status')!({})).toEqual({ success: true, data: 1 });
    expect(sink.failure).not.toHaveBeenCalled();
  });

  it('counts a failure response by channel and code, and returns it unchanged', async () => {
    const { ipc, handlers, sink } = fakeIpc();
    const failure = { success: false, error: 'secret path', code: 'NOT_FOUND' };
    ipc.handle('git:push', async () => failure);
    expect(await handlers.get('git:push')!({})).toBe(failure);
    expect(sink.failure).toHaveBeenCalledWith('git:push', 'NOT_FOUND');
  });

  it('reports a throw as an exception and rethrows it', async () => {
    const { ipc, handlers, sink } = fakeIpc();
    const err = new Error('boom');
    ipc.handle('pty:startDirect', () => {
      throw err;
    });
    await expect(handlers.get('pty:startDirect')!({})).rejects.toBe(err);
    expect(sink.exception).toHaveBeenCalledWith(err, 'pty:startDirect');
  });

  it("leaves telemetry's own channels alone", async () => {
    const { ipc, handlers, sink } = fakeIpc();
    ipc.handle('telemetry:capture', () => ({ success: false }));
    await handlers.get('telemetry:capture')!({});
    expect(sink.failure).not.toHaveBeenCalled();
  });
});
