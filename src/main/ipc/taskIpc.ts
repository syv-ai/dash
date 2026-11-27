import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { createTaskInputSchema, deleteTaskOptionsSchema, taskEffortSchema } from './schemas';
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
  SetTaskLaunchOptionsInput,
} from '@shared/types';
import { launchOptionsProblem } from '@shared/launchOptions';

const launchOptionsInputSchema = z.looseObject({
  taskId: z.string(),
  extraArgs: z.string().nullable().optional(),
  addDirs: z.array(z.string()).optional(),
  effort: taskEffortSchema.nullable().optional(),
});

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

  // Only the options: the renderer restarts a running session afterwards
  // (changeSessionSetting), and the next dispatch passes them.
  ipcMain.handle('task:setLaunchOptions', (_event, input: SetTaskLaunchOptionsInput) => {
    try {
      parseArgs('task:setLaunchOptions', launchOptionsInputSchema, input);
      const task = DatabaseService.getTask(input.taskId);
      if (!task) throw new Error(`Task not found: ${input.taskId}`);
      const problem = launchOptionsProblem(input);
      if (problem) throw new Error(problem);
      DatabaseService.setTaskLaunchOptions(input.taskId, input);
      taskEvents.emitChanged(task.projectId);
      return { success: true, data: DatabaseService.getTask(input.taskId) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Keyed by folder, so a task not made yet (the New task dialog) asks for its
  // project's. Read per ask: a settings file can change while Dash runs.
  ipcMain.handle('claude:bypassAvailability', async (_event, cwd: string) => {
    try {
      parseArgs('claude:bypassAvailability', z.string().min(1), cwd);
      return { success: true, data: await readBypassAvailability(cwd) };
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
