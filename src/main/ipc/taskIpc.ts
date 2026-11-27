import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { createTaskInputSchema, deleteTaskOptionsSchema } from './schemas';
import { TaskService } from '../services/TaskService';
import { DatabaseService } from '../services/DatabaseService';
import { taskEvents } from '../services/taskEvents';
import { messageAddresses, sessionLastActiveMs } from '../services/claudeSessionRegistry';
import { readBypassAvailability } from '../services/claudeBypassPolicy';
import type {
  CreateTaskInput,
  DeleteTaskOptions,
  SetTaskDashAccessInput,
  SetTaskFavoriteInput,
} from '@shared/types';

/** Task lifecycle from the task dialog and sidebar; TaskService does the work. */
export function registerTaskIpc(): void {
  ipcMain.handle('task:create', async (_event, input: CreateTaskInput) => {
    try {
      parseArgs('task:create', createTaskInputSchema, input);
      // The pane that mounts next starts the session (and runs the trust
      // prompt if the folder needs it).
      const data = await TaskService.create(input, { startSession: false, source: 'ui' });
      return { success: true, data };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('task:delete', async (_event, id: string, options?: DeleteTaskOptions) => {
    try {
      parseArgs('task:delete', z.string(), id);
      parseArgs('task:delete', deleteTaskOptionsSchema.optional(), options);
      await TaskService.delete(id, options ?? {});
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('task:archive', async (_event, id: string) => {
    try {
      parseArgs('task:archive', z.string(), id);
      await TaskService.archive(id);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('task:restore', async (_event, id: string) => {
    try {
      parseArgs('task:restore', z.string(), id);
      await TaskService.restore(id);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Only the flag: the renderer restarts a running session afterwards, and the
  // session start writes or drops its dashctl access (taskAccess.ts).
  ipcMain.handle('task:setDashAccess', (_event, input: SetTaskDashAccessInput) => {
    try {
      parseArgs(
        'task:setDashAccess',
        z.looseObject({ taskId: z.string(), enabled: z.boolean() }),
        input,
      );
      const task = DatabaseService.getTask(input.taskId);
      if (!task) throw new Error(`Task not found: ${input.taskId}`);
      DatabaseService.setTaskDashAccess(input.taskId, input.enabled);
      taskEvents.emitChanged(task.projectId);
      return { success: true, data: DatabaseService.getTask(input.taskId) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Read per ask: a settings file can change while Dash runs.
  ipcMain.handle('task:bypassAvailability', async (_event, taskId: string) => {
    try {
      parseArgs('task:bypassAvailability', z.string(), taskId);
      const task = DatabaseService.getTask(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      return { success: true, data: await readBypassAvailability(task.path) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('task:setFavorite', (_event, input: SetTaskFavoriteInput) => {
    try {
      parseArgs(
        'task:setFavorite',
        z.looseObject({ taskId: z.string(), favorite: z.boolean() }),
        input,
      );
      const task = DatabaseService.getTask(input.taskId);
      if (!task) throw new Error(`Task not found: ${input.taskId}`);
      DatabaseService.setTaskFavorite(input.taskId, input.favorite);
      taskEvents.emitChanged(task.projectId);
      return { success: true, data: DatabaseService.getTask(input.taskId) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // When the task's conversation last changed: its transcript's mtime.
  ipcMain.handle('task:lastActive', (_event, id: string) => {
    try {
      parseArgs('task:lastActive', z.string(), id);
      const task = DatabaseService.getTask(id);
      if (!task) throw new Error(`Task not found: ${id}`);
      return { success: true, data: sessionLastActiveMs(task) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Read at the moment of copying: the socket changes whenever the session restarts.
  ipcMain.handle('task:messageAddresses', (_event, id: string) => {
    try {
      parseArgs('task:messageAddresses', z.string(), id);
      const task = DatabaseService.getTask(id);
      if (!task) throw new Error(`Task not found: ${id}`);
      return { success: true, data: messageAddresses(task.jobId) };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
