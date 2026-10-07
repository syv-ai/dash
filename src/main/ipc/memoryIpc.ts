import * as fs from 'fs';
import * as path from 'path';
import { ipcMain, shell } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse, ipcError } from './validate';
import { MEMORY_TYPES } from '@shared/types';
import { isMemoryFileName } from '@shared/memoryLinks';
import {
  createMemory,
  deleteMemory,
  indexMemory,
  pruneIndex,
  raiseMemory,
  readProjectMemory,
  resolveMemoryDir,
  updateMemory,
} from '../services/MemoryService';
import { stopWatchingMemory, watchProjectMemory } from '../services/MemoryWatcher';

export const memoryProjectArgsSchema = z.object({
  projectPath: z.string().refine((p) => path.isAbsolute(p), 'must be an absolute path'),
});

const singleLine = z.string().regex(/^[^\r\n]*$/, 'must be a single line');

const memoryFieldsSchema = z.object({
  name: singleLine.trim().min(1).max(200),
  description: singleLine.trim().max(1000),
  type: z.enum(MEMORY_TYPES),
  body: z.string().max(1_000_000),
});

/** A memory's basename: a `.md` file in the memory folder itself, never the index. */
const memoryFileSchema = z
  .string()
  .refine(
    isMemoryFileName,
    'must be a memory file name: a .md in the memory folder, not the index',
  );

export const memoryCreateArgsSchema = memoryProjectArgsSchema.extend({
  ...memoryFieldsSchema.shape,
  /** The memory's MEMORY.md line; left out, the line keeps (or defaults) its own. */
  hook: singleLine.trim().max(1000).optional(),
});

export const memoryUpdateArgsSchema = memoryCreateArgsSchema.extend({
  file: memoryFileSchema,
  expectedMtimeMs: z.number(),
  expectedSizeBytes: z.number(),
});

export const memoryFileArgsSchema = memoryProjectArgsSchema.extend({ file: memoryFileSchema });

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

  // The writes below take a project path and a basename, never a full path:
  // like openDir, they can only ever touch a memory folder (the default one, or
  // the `autoMemoryDirectory` Claude's own settings name).
  ipcMain.handle('memory:create', async (_event, raw: unknown) => {
    try {
      const { projectPath, hook, ...fields } = parseArgs(
        'memory:create',
        memoryCreateArgsSchema,
        raw,
      );
      return { success: true, data: await createMemory(projectPath, fields, hook) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('memory:update', async (_event, raw: unknown) => {
    try {
      const { projectPath, file, expectedMtimeMs, expectedSizeBytes, hook, ...fields } = parseArgs(
        'memory:update',
        memoryUpdateArgsSchema,
        raw,
      );
      const data = await updateMemory(
        projectPath,
        file,
        fields,
        { mtimeMs: expectedMtimeMs, sizeBytes: expectedSizeBytes },
        hook,
      );
      return { success: true, data };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('memory:prune', async (_event, raw: unknown) => {
    try {
      const { projectPath } = parseArgs('memory:prune', memoryProjectArgsSchema, raw);
      return { success: true, data: { removed: await pruneIndex(projectPath) } };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('memory:index', async (_event, raw: unknown) => {
    try {
      const { projectPath, file } = parseArgs('memory:index', memoryFileArgsSchema, raw);
      await indexMemory(projectPath, file);
      return { success: true, data: null };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('memory:raise', async (_event, raw: unknown) => {
    try {
      const { projectPath, file } = parseArgs('memory:raise', memoryFileArgsSchema, raw);
      await raiseMemory(projectPath, file);
      return { success: true, data: null };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('memory:delete', async (_event, raw: unknown) => {
    try {
      const { projectPath, file } = parseArgs('memory:delete', memoryFileArgsSchema, raw);
      const data = await deleteMemory(projectPath, file, (full) => shell.trashItem(full));
      return { success: true, data };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
