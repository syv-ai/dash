import { ipcMain } from 'electron';
import { z } from 'zod';
import { IpcError, errorResponse, parseArgs } from './validate';
import { DatabaseService } from '../services/DatabaseService';
import {
  readTaskScratchpad,
  unwatchTaskScratchpad,
  watchTaskScratchpad,
} from '../services/ScratchpadService';

const taskArgsSchema = z.object({ taskId: z.string().min(1) });

/** The channels name a task, which must be one of Dash's; main resolves its folder. */
function parseTaskArgs(channel: string, raw: unknown): { taskId: string } {
  const args = parseArgs(channel, taskArgsSchema, raw);
  if (!DatabaseService.getTask(args.taskId)) {
    throw new IpcError(`Invalid IPC arguments for ${channel}: no such task`, 'VALIDATION');
  }
  return args;
}

/** The task sidebar's Agent tab: the task session's scratchpad. */
export function registerAgentIpc(): void {
  ipcMain.handle('agent:scratchpad', async (_event, raw: unknown) => {
    try {
      const { taskId } = parseTaskArgs('agent:scratchpad', raw);
      return { success: true, data: await readTaskScratchpad(taskId) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('agent:watchScratchpad', (_event, raw: unknown) => {
    try {
      watchTaskScratchpad(parseTaskArgs('agent:watchScratchpad', raw).taskId);
      return { success: true, data: null };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('agent:unwatchScratchpad', (_event, raw: unknown) => {
    try {
      // Not checked against the DB: a deleted task's watch must still close.
      unwatchTaskScratchpad(parseArgs('agent:unwatchScratchpad', taskArgsSchema, raw).taskId);
      return { success: true, data: null };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
