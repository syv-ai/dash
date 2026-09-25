import * as fs from 'fs';
import * as path from 'path';
import { ipcMain, shell } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse, ipcError } from './validate';
import { readProjectMemory, resolveMemoryDir } from '../services/MemoryService';
import { stopWatchingMemory, watchProjectMemory } from '../services/MemoryWatcher';

export const memoryProjectArgsSchema = z.object({
  projectPath: z.string().refine((p) => path.isAbsolute(p), 'must be an absolute path'),
});

export function registerMemoryIpc(): void {
  ipcMain.handle('memory:get', async (_event, raw: unknown) => {
    try {
      const { projectPath } = parseArgs('memory:get', memoryProjectArgsSchema, raw);
      return { success: true, data: await readProjectMemory(projectPath) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('memory:watch', async (_event, raw: unknown) => {
    try {
      const { projectPath } = parseArgs('memory:watch', memoryProjectArgsSchema, raw);
      await watchProjectMemory(projectPath);
      return { success: true, data: null };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('memory:unwatch', () => {
    stopWatchingMemory();
    return { success: true, data: null };
  });

  // Reveal the folder in the OS file manager. The dir is recomputed here, not
  // taken from the renderer, so this can only ever open a memory folder.
  ipcMain.handle('memory:openDir', async (_event, raw: unknown) => {
    try {
      const { projectPath } = parseArgs('memory:openDir', memoryProjectArgsSchema, raw);
      const dir = await resolveMemoryDir(projectPath);
      if (!fs.existsSync(dir)) return ipcError(`No memory folder at ${dir}`, 'NOT_FOUND');
      const failure = await shell.openPath(dir);
      if (failure) return ipcError(failure, 'UNKNOWN');
      return { success: true, data: null };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
