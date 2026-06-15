import type { IpcErrorCode, IpcResponse } from '@shared/types';

/**
 * An error carrying a machine-readable IPC error code. Thrown by the validation
 * layer (and any handler that wants to signal a specific category) so that
 * `errorResponse` can surface the code to the renderer instead of flattening
 * every failure to an opaque string.
 */
export class IpcError extends Error {
  readonly code: IpcErrorCode;

  constructor(message: string, code: IpcErrorCode) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
  }
}

/**
 * Build a failure IpcResponse from a caught error. An `IpcError` contributes its
 * code; anything else is reported as `UNKNOWN`. The message is the Error's
 * `.message` (or the stringified value) — no `Error:` prefix, consistent across
 * every handler.
 */
export function errorResponse(error: unknown): IpcResponse<never> {
  const code: IpcErrorCode = error instanceof IpcError ? error.code : 'UNKNOWN';
  const message = error instanceof Error ? error.message : String(error);
  return { success: false, error: message, code };
}

/** Build a failure IpcResponse for an explicit domain failure (e.g. NOT_FOUND). */
export function ipcError(message: string, code: IpcErrorCode): IpcResponse<never> {
  return { success: false, error: message, code };
}
