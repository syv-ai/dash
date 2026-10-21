import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { diffCommentInputSchema } from './schemas';
import { diffCommentsRepo } from '../services/diffCommentsRepo';
import type { DiffComment, DiffCommentInput, IpcResponse } from '@shared/types';

export function registerDiffCommentsIpc(): void {
  ipcMain.handle(
    'diffComments:list',
    (_e, args: { taskId: string }): IpcResponse<DiffComment[]> => {
      try {
        parseArgs('diffComments:list', z.looseObject({ taskId: z.string() }), args);
        return { success: true, data: diffCommentsRepo().listByTask(args.taskId) };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  ipcMain.handle('diffComments:upsert', (_e, c: DiffCommentInput): IpcResponse<DiffComment> => {
    try {
      parseArgs('diffComments:upsert', diffCommentInputSchema, c);
      return { success: true, data: diffCommentsRepo().upsertFromUser(c) };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle('diffComments:delete', (_e, args: { id: string }): IpcResponse<void> => {
    try {
      parseArgs('diffComments:delete', z.looseObject({ id: z.string() }), args);
      diffCommentsRepo().delete(args.id);
      return { success: true };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle(
    'diffComments:pruneForTask',
    (
      _e,
      args: { taskId: string; existingFilePaths: string[] },
    ): IpcResponse<{ deleted: number }> => {
      try {
        parseArgs(
          'diffComments:pruneForTask',
          z.looseObject({ taskId: z.string(), existingFilePaths: z.array(z.string()) }),
          args,
        );
        const deleted = diffCommentsRepo().prune(args.taskId, new Set(args.existingFilePaths));
        return { success: true, data: { deleted } };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );
}
