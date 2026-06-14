import { z } from 'zod';

/**
 * Runtime validation for IPC handler arguments.
 *
 * The renderer/main IPC boundary is typed (electron-api.d.ts) but the types are
 * erased at runtime — a malformed or unexpected payload would otherwise flow
 * straight into services. These helpers validate the raw arguments against a
 * zod schema at the boundary so handlers operate on known-good, typed values.
 */

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/**
 * Validate `raw` against `schema` for an invoke handler. On failure throws an
 * Error with a compact, readable message — caught by the handler's try/catch
 * and surfaced to the renderer as `{ success: false, error }`.
 */
export function parseArgs<T>(channel: string, schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new Error(`Invalid IPC arguments for ${channel}: ${formatIssues(result.error)}`);
}

/**
 * Validate `raw` for a fire-and-forget (`ipcMain.on`) channel, which has no
 * caller to throw back to. Returns the typed value, or `undefined` (logging the
 * reason) when validation fails so the handler can drop the message.
 */
export function parseArgsSafe<T>(
  channel: string,
  schema: z.ZodType<T>,
  raw: unknown,
): T | undefined {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  console.error(`[ipc] dropping ${channel}: ${formatIssues(result.error)}`);
  return undefined;
}
