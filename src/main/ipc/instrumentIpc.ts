import type { IpcMain } from 'electron';

export interface IpcFailureSink {
  /** A handler answered `{ success: false, code }`. */
  failure(channel: string, code: string): void;
  /** A handler threw (the renderer gets a rejected invoke). */
  exception(error: unknown, channel: string): void;
}

/** Channels left alone: telemetry's own, so a failing report can't report itself. */
const UNWATCHED = /^telemetry:/;

/**
 * Decorate `ipc.handle` so every handler registered after this call reports
 * its failures: an `IpcResponse` with `success: false` by channel and error
 * code (git, forge, PTY and session failures all come back this way), a throw
 * as an exception. The handler's result and errors pass through unchanged.
 * Call once, before the handlers register (ipc/index.ts).
 */
export function instrumentIpcHandlers(ipc: Pick<IpcMain, 'handle'>, sink: IpcFailureSink): void {
  const handle = ipc.handle.bind(ipc);
  ipc.handle = (channel, listener) => {
    if (UNWATCHED.test(channel)) return handle(channel, listener);
    return handle(channel, async (event, ...args) => {
      let result: unknown;
      try {
        result = await listener(event, ...args);
      } catch (err) {
        sink.exception(err, channel);
        throw err;
      }
      if (isFailure(result)) sink.failure(channel, result.code ?? 'UNKNOWN');
      return result;
    });
  };
}

function isFailure(value: unknown): value is { success: false; code?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { success?: unknown }).success === false
  );
}
