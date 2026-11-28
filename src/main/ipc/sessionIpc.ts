import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { supervisorService } from '../services/SupervisorService';
import { DatabaseService } from '../services/DatabaseService';
import {
  startSessionAttach,
  killPtyAwait,
  FOREIGN_SESSION_PTY_PREFIX,
} from '../services/ptyManager';
import { TelemetryService } from '../services/TelemetryService';
import { IpcError } from './ipcErrors';
import { withinGitRepo } from '../utils/gitPresence';

const execFileAsync = promisify(execFile);

/**
 * Sessions under Claude Code's supervisor that Dash shows but does not own:
 * listing, attach/stop/remove, and "Adopt as task". Task-owned sessions go
 * through the pty:* handlers (their lifecycle follows the task).
 */
export function registerSessionIpc(): void {
  ipcMain.handle('session:list', async (_event, args?: { refresh?: boolean }) => {
    try {
      parseArgs(
        'session:list',
        z.looseObject({ refresh: z.boolean().optional() }).optional(),
        args,
      );
      const rows = args?.refresh
        ? await supervisorService.refresh('renderer')
        : supervisorService.getSessions();
      return { success: true, data: rows };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle(
    'session:attach',
    async (
      event,
      args: { jobId: string; cwd: string; cols: number; rows: number; isDark?: boolean },
    ) => {
      try {
        parseArgs(
          'session:attach',
          z.looseObject({
            jobId: z.string(),
            cwd: z.string(),
            cols: z.number(),
            rows: z.number(),
            isDark: z.boolean().optional(),
          }),
          args,
        );
        const result = await startSessionAttach({ ...args, sender: event.sender });
        return { success: true, data: result };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  ipcMain.handle('session:stop', async (_event, jobId: string) => {
    try {
      parseArgs('session:stop', z.string(), jobId);
      await killPtyAwait(`${FOREIGN_SESSION_PTY_PREFIX}${jobId}`);
      await supervisorService.stop(jobId);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('session:remove', async (_event, jobId: string) => {
    try {
      parseArgs('session:remove', z.string(), jobId);
      await killPtyAwait(`${FOREIGN_SESSION_PTY_PREFIX}${jobId}`);
      await supervisorService.stop(jobId).catch(() => {});
      await supervisorService.remove(jobId);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Turn a foreign session into a Dash task at its cwd. The branch is read
  // from the directory; `useWorktree` says whether the cwd is a linked
  // worktree of the project (git-common-dir differs from git-dir).
  ipcMain.handle('session:adopt', async (_event, args: { projectId: string; jobId: string }) => {
    try {
      parseArgs('session:adopt', z.looseObject({ projectId: z.string(), jobId: z.string() }), args);
      const row = (await supervisorService.refresh('adopt')).find((r) => r.id === args.jobId);
      if (!row) throw new IpcError(`Session ${args.jobId} is no longer listed`, 'NOT_FOUND');
      if (DatabaseService.getTaskByJobId(args.jobId)) {
        throw new IpcError('That session already belongs to a task', 'VALIDATION');
      }
      const git = async (gitArgs: string[]): Promise<string> =>
        (await execFileAsync('git', gitArgs, { cwd: row.cwd })).stdout.trim();
      let branch = '';
      let useWorktree = false;
      // A plain folder: an in-place task with no branch, no git spawned.
      if (withinGitRepo(row.cwd)) {
        try {
          branch = await git(['branch', '--show-current']);
          const [gitDir, commonDir] = await Promise.all([
            git(['rev-parse', '--path-format=absolute', '--git-dir']),
            git(['rev-parse', '--path-format=absolute', '--git-common-dir']),
          ]);
          useWorktree = gitDir !== commonDir;
        } catch {
          // Git failed: in place, with no branch label.
        }
      }
      await killPtyAwait(`${FOREIGN_SESSION_PTY_PREFIX}${args.jobId}`);
      const task = DatabaseService.saveTask({
        projectId: args.projectId,
        name: row.name || `session ${args.jobId}`,
        branch,
        path: row.cwd,
        useWorktree,
        status: 'active',
      });
      DatabaseService.setTaskSession(task.id, {
        jobId: args.jobId,
        sessionId: row.sessionId ?? null,
      });
      TelemetryService.capture('session_adopted');
      return { success: true, data: DatabaseService.getTask(task.id) ?? task };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
