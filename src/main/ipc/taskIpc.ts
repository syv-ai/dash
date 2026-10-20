import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { createTaskInputSchema, deleteTaskOptionsSchema } from './schemas';
import { TaskService } from '../services/TaskService';
import { DatabaseService } from '../services/DatabaseService';
import { taskEvents } from '../services/taskEvents';
import type { CreateTaskInput, DeleteTaskOptions, SetTaskDashAccessInput } from '@shared/types';

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
}
