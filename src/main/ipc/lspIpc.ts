/**
 * Language servers over IPC (main owns the processes; see `src/main/lsp/`).
 *
 * Invoke (each resolves to an `IpcResponse`):
 *   lsp:open    {worktree, uri, version, text} → {serverId: string | null}
 *               `worktree` is a live task's path; `uri` a file:// URI inside it
 *               (Monaco's `Uri.file(abs).toString()`). The server is picked by
 *               file extension; null means no server handles the file and
 *               nothing is tracked. Re-opening a URI replaces its content.
 *   lsp:request {uri, method, params, requestId} → the LSP result, as is
 *               `uri` must be open; `method` one of `LSP_REQUEST_METHODS`;
 *               `params` the LSP params (their `textDocument.uri` is `uri`);
 *               `requestId` a caller-chosen id for `lsp:cancel`. Fails with
 *               code CANCELLED when cancelled, UNAVAILABLE when the server is
 *               missing or failed, NOT_FOUND when `uri` isn't open.
 *   lsp:status  {worktree} → LspStatusEvent
 * Send (fire-and-forget, ordered after a preceding lsp:open):
 *   lsp:change  {uri, version, text}   full text, version strictly increasing
 *   lsp:close   {uri}
 *   lsp:cancel  {requestId}            → `$/cancelRequest`
 * Push:
 *   lsp:diagnostics LspDiagnosticsEvent — to the renderer that opened `uri`;
 *                   drop it when `version` is older than the model's.
 *   lsp:status      LspStatusEvent — to every window, on any state change.
 *
 * A renderer's documents close when it reloads or goes away.
 */
import * as path from 'path';
import { ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import { URI } from 'vscode-uri';
import { LSP_REQUEST_METHODS, type LspStatusEvent } from '@shared/lsp';
import { parseArgs, parseArgsSafe, errorResponse, IpcError } from './validate';
import { resolveInsideCwd } from './editorIpc';
import { DatabaseService } from '../services/DatabaseService';
import { languageServers } from '../lsp/languageServers';

function isFileUri(value: string): boolean {
  try {
    return URI.parse(value, true).scheme === 'file';
  } catch {
    return false;
  }
}

const fileUri = z.string().max(4096).refine(isFileUri, 'must be a file:// URI');
const version = z.number().int().nonnegative();
const requestId = z.union([z.string().min(1).max(128), z.number().int()]).transform(String);
const worktree = z.string().refine((p) => path.isAbsolute(p), 'must be an absolute path');

export const lspOpenSchema = z.object({ worktree, uri: fileUri, version, text: z.string() });
export const lspChangeSchema = z.object({ uri: fileUri, version, text: z.string() });
export const lspCloseSchema = z.object({ uri: fileUri });
export const lspRequestSchema = z.object({
  uri: fileUri,
  method: z.enum(LSP_REQUEST_METHODS),
  params: z.record(z.string(), z.unknown()),
  requestId,
});
export const lspCancelSchema = z.object({ requestId });
export const lspStatusSchema = z.object({ worktree });

/** `worktree` must be a live (unarchived) task's folder, and `uri` a file inside it. */
function assertInsideTask(channel: string, args: { worktree: string; uri: string }): void {
  const task = DatabaseService.getTaskByPath(args.worktree);
  if (!task || task.archivedAt) {
    throw new IpcError(
      `Invalid IPC arguments for ${channel}: not a live task's worktree`,
      'VALIDATION',
    );
  }
  try {
    resolveInsideCwd(args.worktree, URI.parse(args.uri).fsPath);
  } catch {
    throw new IpcError(
      `Invalid IPC arguments for ${channel}: uri is outside the worktree`,
      'VALIDATION',
    );
  }
}

const watchedOwners = new Set<number>();

/** Close an owner's documents once it reloads or is destroyed. */
function watchOwner(sender: WebContents): void {
  const id = sender.id;
  if (watchedOwners.has(id)) return;
  watchedOwners.add(id);
  sender.on('did-navigate', () => languageServers.closeOwner(id));
  sender.once('destroyed', () => {
    watchedOwners.delete(id);
    languageServers.closeOwner(id);
  });
}

function logDropped(channel: string, err: unknown): void {
  console.warn(`[ipc] ${channel}:`, err instanceof Error ? err.message : err);
}

export function registerLspIpc(): void {
  ipcMain.handle('lsp:open', (event, raw: unknown) => {
    try {
      const args = parseArgs('lsp:open', lspOpenSchema, raw);
      assertInsideTask('lsp:open', args);
      watchOwner(event.sender);
      return { success: true, data: languageServers.open(event.sender.id, args) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('lsp:request', async (event, raw: unknown) => {
    try {
      const args = parseArgs('lsp:request', lspRequestSchema, raw);
      return { success: true, data: await languageServers.request(event.sender.id, args) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('lsp:status', (_event, raw: unknown) => {
    try {
      const args = parseArgs('lsp:status', lspStatusSchema, raw);
      const data: LspStatusEvent = {
        worktree: args.worktree,
        servers: languageServers.status(args.worktree),
      };
      return { success: true, data };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.on('lsp:change', (_event, raw: unknown) => {
    const args = parseArgsSafe('lsp:change', lspChangeSchema, raw);
    if (!args) return;
    try {
      languageServers.change(args);
    } catch (err) {
      logDropped('lsp:change', err);
    }
  });

  ipcMain.on('lsp:close', (_event, raw: unknown) => {
    const args = parseArgsSafe('lsp:close', lspCloseSchema, raw);
    if (args) languageServers.close(args.uri);
  });

  ipcMain.on('lsp:cancel', (event, raw: unknown) => {
    const args = parseArgsSafe('lsp:cancel', lspCancelSchema, raw);
    if (args) languageServers.cancel(event.sender.id, args.requestId);
  });
}
