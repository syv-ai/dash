import * as fs from 'fs';
import * as path from 'path';
import { ipcMain, shell } from 'electron';
import { z } from 'zod';
import { IpcError, parseArgs, errorResponse, ipcError } from './validate';
import { readProjectMemory, resolveMemoryDir } from '../services/MemoryService';
import { stopWatchingMemory, watchProjectMemory } from '../services/MemoryWatcher';
import { DatabaseService } from '../services/DatabaseService';

export const memoryProjectArgsSchema = z.object({
  projectPath: z.string().refine((p) => path.isAbsolute(p), 'must be an absolute path'),
});

/**
 * `parseArgs` for the memory channels, which all name a project: the path must
 * be one of Dash's own projects, so the renderer can't point these handlers at
 * the memory of an arbitrary folder.
 */
function parseProjectArgs(channel: string, raw: unknown): { projectPath: string } {
  const args = parseArgs(channel, memoryProjectArgsSchema, raw);
  if (!DatabaseService.getProjects().some((p) => p.path === args.projectPath)) {
    throw new IpcError(
      `Invalid IPC arguments for ${channel}: projectPath is not a Dash project`,
      'VALIDATION',
    );
  }
  return args;
}

export function registerMemoryIpc(): void {
  ipcMain.handle('memory:get', async (_event, raw: unknown) => {
    try {
      const { projectPath } = parseProjectArgs('memory:get', raw);
      return { success: true, data: await readProjectMemory(projectPath) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('memory:watch', async (_event, raw: unknown) => {
    try {
      const { projectPath } = parseProjectArgs('memory:watch', raw);
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
      const { projectPath } = parseProjectArgs('memory:openDir', raw);
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
