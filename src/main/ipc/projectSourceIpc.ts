import { ipcMain } from 'electron';
import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { parseArgs, parseArgsSafe, errorResponse } from './validate';
import { buildSourceCommand, getCloneMethod } from '../services/cloneMethods';
import { broadcast } from '../utils/broadcast';
import { DatabaseService } from '../services/DatabaseService';
import { expandUserPath, inspectPath } from '../services/projectSourcePaths';
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

/** git's own `fatal:`/`error:` lines, not the whole command line Node prefixes. */
function gitFailure(e: Error & { stderr?: string }): string {
  const lines = (e.stderr ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(fatal|error):/.test(l));
  return lines.length ? lines.join(' ') : e.message;
}

/** Pick a non-colliding folder name inside parentDir. */
function uniqueName(parentDir: string, base: string): string {
  if (!existsSync(join(parentDir, base))) return base;
  return `${base}-${randomBytes(2).toString('hex')}`;
}

export function registerProjectSourceIpc(): void {
  // What a path typed into the New Project dialog is: a repo, a folder, a folder
  // to create, or part of a project already.
  ipcMain.handle('project:inspectPath', (_event, input: string) => {
    try {
      parseArgs('project:inspectPath', z.string().min(1).max(4096), input);
      return { success: true, data: inspectPath(input, DatabaseService.getProjects()) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Non-interactive git clone into a chosen parent dir.
  ipcMain.handle('project:clone', async (_event, args: { url: string; parentDir: string }) => {
    try {
      parseArgs('project:clone', z.looseObject({ url: z.string(), parentDir: z.string() }), args);
      const parentDir = expandUserPath(args.parentDir);
      if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
      const name = uniqueName(parentDir, deriveName(args.url));
      const { command } = buildSourceCommand('git', { url: args.url, parentDir, name });
      const [, ...rest] = command; // command[0] === 'git'
      await execFileAsync('git', rest, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }).catch(
        (e: Error & { stderr?: string }) => {
          throw new Error(gitFailure(e));
        },
      );
      return { success: true, data: { path: join(parentDir, name), name } };
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
        const parentDir = expandUserPath(args.parentDir);
        if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
        const name = uniqueName(parentDir, args.name.trim() || 'project');
        const dest = join(parentDir, name);
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
      let parentDir: string;
      try {
        parentDir = expandUserPath(args.parentDir);
      } catch {
        broadcast('scaffold:exit', { sessionId: args.sessionId, exitCode: 1, resultPath: null });
        return;
      }
      if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
      const name = uniqueName(parentDir, deriveName(args.url));
      const built = buildSourceCommand(args.methodId, { url: args.url, parentDir, name });
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

  ipcMain.on('scaffold:input', (_event, args: { sessionId: string; data: string }) => {
    const v = parseArgsSafe(
      'scaffold:input',
      z.looseObject({ sessionId: z.string(), data: z.string() }),
      args,
    );
    if (v === undefined) return;
    writeScaffold(args.sessionId, args.data);
  });
  ipcMain.on(
    'scaffold:resize',
    (_event, args: { sessionId: string; cols: number; rows: number }) => {
      const v = parseArgsSafe(
        'scaffold:resize',
        z.looseObject({ sessionId: z.string(), cols: z.number(), rows: z.number() }),
        args,
      );
      if (v === undefined) return;
      resizeScaffold(args.sessionId, args.cols, args.rows);
    },
  );
  ipcMain.on('scaffold:kill', (_event, args: { sessionId: string }) => {
    const v = parseArgsSafe('scaffold:kill', z.looseObject({ sessionId: z.string() }), args);
    if (v === undefined) return;
    killScaffold(args.sessionId);
  });
}
