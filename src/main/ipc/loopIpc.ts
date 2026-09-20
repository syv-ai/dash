import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { loopController } from '../services/LoopController';
import { TelemetryService } from '../services/TelemetryService';

/**
 * IPC for the agentic-loop lifecycle. The renderer only starts/pauses/resumes/
 * stops a loop by taskId; the LoopController owns everything downstream (seeding,
 * spawning both agents, the scheduler). Status is pushed to the renderer on the
 * `loop:status` channel (see LoopController.emitStatus); `loop:status:getAll` is
 * the pull used to hydrate on mount.
 */
export function registerLoopIpc(): void {
  const taskIdSchema = z.string();

  ipcMain.handle('loop:start', async (_event, taskId: string) => {
    try {
      parseArgs('loop:start', taskIdSchema, taskId);
      await loopController.start(taskId);
      TelemetryService.capture('loop_started');
      return { success: true, data: loopController.getStatus(taskId) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('loop:pause', async (_event, taskId: string) => {
    try {
      parseArgs('loop:pause', taskIdSchema, taskId);
      loopController.pause(taskId);
      return { success: true, data: loopController.getStatus(taskId) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('loop:resume', async (_event, taskId: string) => {
    try {
      parseArgs('loop:resume', taskIdSchema, taskId);
      await loopController.resume(taskId);
      return { success: true, data: loopController.getStatus(taskId) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('loop:stop', async (_event, taskId: string) => {
    try {
      parseArgs('loop:stop', taskIdSchema, taskId);
      await loopController.stop(taskId);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('loop:status:getAll', () => {
    return { success: true, data: loopController.getAllStatuses() };
  });
}
