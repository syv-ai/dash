import { ipcMain } from 'electron';
import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { parseArgs, errorResponse } from './validate';
import { buildSourceCommand, getCloneMethod } from '../services/cloneMethods';
import {
  startScaffold,
  writeScaffold,
  resizeScaffold,
  killScaffold,
} from '../services/ScaffoldService';

const execFileAsync = promisify(execFile);

/** Derive a folder name from a repo/template URL. */
function deriveName(url: string): string {
  const urlPath = url.replace(/\.git$/, '').replace(/\/$/, '');
  return urlPath.split('/').pop() || 'project';
}

/** Pick a non-colliding folder name inside parentDir. */
function uniqueName(parentDir: string, base: string): string {
  if (!existsSync(join(parentDir, base))) return base;
  return `${base}-${randomBytes(2).toString('hex')}`;
}

export function registerProjectSourceIpc(): void {
  // Non-interactive git clone into a chosen parent dir.
  ipcMain.handle('project:clone', async (_event, args: { url: string; parentDir: string }) => {
    try {
      parseArgs('project:clone', z.looseObject({ url: z.string(), parentDir: z.string() }), args);
      if (!existsSync(args.parentDir)) mkdirSync(args.parentDir, { recursive: true });
      const name = uniqueName(args.parentDir, deriveName(args.url));
      const { command } = buildSourceCommand('git', {
        url: args.url,
        parentDir: args.parentDir,
        name,
      });
      const [, ...rest] = command; // command[0] === 'git'
      await execFileAsync('git', rest, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
      return { success: true, data: { path: join(args.parentDir, name), name } };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Create an empty project directory, optionally `git init`.
  ipcMain.handle(
    'project:createEmpty',
    async (_event, args: { parentDir: string; name: string; initGit: boolean }) => {
      try {
        parseArgs(
          'project:createEmpty',
          z.looseObject({ parentDir: z.string(), name: z.string(), initGit: z.boolean() }),
          args,
        );
        if (!existsSync(args.parentDir)) mkdirSync(args.parentDir, { recursive: true });
        const name = uniqueName(args.parentDir, args.name.trim() || 'project');
        const dest = join(args.parentDir, name);
        mkdirSync(dest, { recursive: true });
        if (args.initGit) {
          await execFileAsync('git', ['init'], { cwd: dest, timeout: 30000 });
        }
        return { success: true, data: { path: dest, name } };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // List a directory's entries — used by the renderer's folder-picker fallback
  // when scaffold result detection is ambiguous.
  ipcMain.handle('project:listDir', (_event, dir: string) => {
    try {
      parseArgs('project:listDir', z.string(), dir);
      const entries = existsSync(dir) ? readdirSync(dir) : [];
      return { success: true, data: entries };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Interactive scaffold (cookiecutter/copier) over the scaffold pty channel.
  ipcMain.on(
    'scaffold:start',
    (
      _event,
      args: {
        sessionId: string;
        methodId: string;
        url: string;
        parentDir: string;
        cols: number;
        rows: number;
      },
    ) => {
      const method = getCloneMethod(args.methodId);
      if (!method || !method.interactive) return;
      if (!existsSync(args.parentDir)) mkdirSync(args.parentDir, { recursive: true });
      const name = uniqueName(args.parentDir, deriveName(args.url));
      const built = buildSourceCommand(args.methodId, {
        url: args.url,
        parentDir: args.parentDir,
        name,
      });
      void startScaffold({
        sessionId: args.sessionId,
        command: built.command,
        cwd: built.cwd,
        detect: built.detect,
        dest: built.dest,
        cols: args.cols,
        rows: args.rows,
      });
    },
  );

  ipcMain.on('scaffold:input', (_event, args: { sessionId: string; data: string }) =>
    writeScaffold(args.sessionId, args.data),
  );
  ipcMain.on('scaffold:resize', (_event, args: { sessionId: string; cols: number; rows: number }) =>
    resizeScaffold(args.sessionId, args.cols, args.rows),
  );
  ipcMain.on('scaffold:kill', (_event, args: { sessionId: string }) =>
    killScaffold(args.sessionId),
  );
}
