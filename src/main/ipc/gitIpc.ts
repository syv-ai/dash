import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse, ipcError } from './validate';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { homedir } from 'os';
import { GitService } from '../services/GitService';
import type { ParserEvent } from '../services/preCommitParser';
import { startWatching, stopWatching } from '../services/FileWatcherService';

const execFileAsync = promisify(execFile);

const activeCommits = new Map<string, { cancel: () => void }>();

export function registerGitIpc(): void {
  // Clone a git repository
  ipcMain.handle('git:clone', async (_event, args: { url: string }) => {
    try {
      parseArgs('git:clone', z.looseObject({ url: z.string() }), args);
      const { url } = args;

      // Extract repo name from URL
      const urlPath = url.replace(/\.git$/, '').replace(/\/$/, '');
      let repoName = urlPath.split('/').pop() || 'repo';

      // Clone destination: ~/Dash/<repo-name>
      const dashDir = join(homedir(), 'Dash');
      if (!existsSync(dashDir)) {
        mkdirSync(dashDir, { recursive: true });
      }

      let targetDir = join(dashDir, repoName);
      if (existsSync(targetDir)) {
        const suffix = randomBytes(2).toString('hex');
        repoName = `${repoName}-${suffix}`;
        targetDir = join(dashDir, repoName);
      }

      await execFileAsync('git', ['clone', url, targetDir], {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });

      return { success: true, data: { path: targetDir, name: repoName } };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Get full git status for a directory
  ipcMain.handle('git:getStatus', async (_event, cwd: string) => {
    try {
      parseArgs('git:getStatus', z.string(), cwd);
      const status = await GitService.getStatus(cwd);
      return { success: true, data: status };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Get diff for a specific file
  ipcMain.handle(
    'git:getDiff',
    async (
      _event,
      args: { cwd: string; filePath?: string; staged?: boolean; contextLines?: number },
    ) => {
      try {
        parseArgs(
          'git:getDiff',
          z.looseObject({
            cwd: z.string(),
            filePath: z.string().optional(),
            staged: z.boolean().optional(),
            contextLines: z.number().optional(),
          }),
          args,
        );
        const diff = await GitService.getDiff(
          args.cwd,
          args.filePath,
          args.staged,
          args.contextLines,
        );
        return { success: true, data: diff };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // Get diff for an untracked file
  ipcMain.handle(
    'git:getDiffUntracked',
    async (_event, args: { cwd: string; filePath: string; contextLines?: number }) => {
      try {
        parseArgs(
          'git:getDiffUntracked',
          z.looseObject({
            cwd: z.string(),
            filePath: z.string(),
            contextLines: z.number().optional(),
          }),
          args,
        );
        const diff = await GitService.getDiffUntracked(args.cwd, args.filePath, args.contextLines);
        return { success: true, data: diff };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // Stage one or more files in a single git invocation
  ipcMain.handle('git:stageFiles', async (_event, args: { cwd: string; filePaths: string[] }) => {
    try {
      parseArgs(
        'git:stageFiles',
        z.looseObject({ cwd: z.string(), filePaths: z.array(z.string()) }),
        args,
      );
      await GitService.stageFiles(args.cwd, args.filePaths);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Stage all files
  ipcMain.handle('git:stageAll', async (_event, cwd: string) => {
    try {
      parseArgs('git:stageAll', z.string(), cwd);
      await GitService.stageAll(cwd);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Unstage one or more files in a single git invocation
  ipcMain.handle('git:unstageFiles', async (_event, args: { cwd: string; filePaths: string[] }) => {
    try {
      parseArgs(
        'git:unstageFiles',
        z.looseObject({ cwd: z.string(), filePaths: z.array(z.string()) }),
        args,
      );
      await GitService.unstageFiles(args.cwd, args.filePaths);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Unstage all files
  ipcMain.handle('git:unstageAll', async (_event, cwd: string) => {
    try {
      parseArgs('git:unstageAll', z.string(), cwd);
      await GitService.unstageAll(cwd);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Discard changes (tracked checkout + untracked unlinks) for one or more files
  ipcMain.handle('git:discardFiles', async (_event, args: { cwd: string; filePaths: string[] }) => {
    try {
      parseArgs(
        'git:discardFiles',
        z.looseObject({ cwd: z.string(), filePaths: z.array(z.string()) }),
        args,
      );
      await GitService.discardFiles(args.cwd, args.filePaths);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Commit staged changes
  ipcMain.handle(
    'git:commit',
    async (_event, args: { cwd: string; message: string; allowEmpty?: boolean }) => {
      try {
        parseArgs(
          'git:commit',
          z.looseObject({
            cwd: z.string(),
            message: z.string(),
            allowEmpty: z.boolean().optional(),
          }),
          args,
        );
        await GitService.commit(args.cwd, args.message, { allowEmpty: args.allowEmpty });
        return { success: true };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // Start a streamed commit run. Parsed pre-commit/prek events arrive on
  // `git:commitEvent` keyed by requestId; the final event has `type: 'close'`.
  ipcMain.handle(
    'git:commitStart',
    async (event, args: { cwd: string; message: string; allowEmpty?: boolean }) => {
      try {
        parseArgs(
          'git:commitStart',
          z.looseObject({
            cwd: z.string(),
            message: z.string(),
            allowEmpty: z.boolean().optional(),
          }),
          args,
        );
        const requestId = randomBytes(8).toString('hex');
        const wc = event.sender;
        const handle = GitService.commitStreamed(
          args.cwd,
          args.message,
          { allowEmpty: args.allowEmpty },
          (parserEvent: ParserEvent) => {
            if (!wc.isDestroyed()) {
              wc.send('git:commitEvent', { requestId, event: parserEvent });
            }
          },
          (closeResult) => {
            activeCommits.delete(requestId);
            if (!wc.isDestroyed()) {
              wc.send('git:commitEvent', {
                requestId,
                event: { type: 'close', ...closeResult },
              });
            }
          },
        );
        activeCommits.set(requestId, handle);
        return { success: true, data: { requestId } };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // Append a path to the repo's .gitignore (creates the file if missing).
  ipcMain.handle('git:gitignoreAdd', async (_event, args: { cwd: string; filePath: string }) => {
    try {
      parseArgs('git:gitignoreAdd', z.looseObject({ cwd: z.string(), filePath: z.string() }), args);
      await GitService.addToGitignore(args.cwd, args.filePath);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Cancel an in-flight streamed commit (sends SIGTERM to the git child).
  ipcMain.handle('git:commitCancel', async (_event, args: { requestId: string }) => {
    parseArgs('git:commitCancel', z.looseObject({ requestId: z.string() }), args);
    const handle = activeCommits.get(args.requestId);
    if (!handle) return ipcError('No active commit with that id', 'NOT_FOUND');
    handle.cancel();
    return { success: true };
  });

  // Push to remote
  ipcMain.handle('git:push', async (_event, cwd: string) => {
    try {
      parseArgs('git:push', z.string(), cwd);
      await GitService.push(cwd);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Check if a remote branch exists
  ipcMain.handle(
    'git:remoteBranchExists',
    async (_event, args: { cwd: string; branch: string }) => {
      try {
        parseArgs(
          'git:remoteBranchExists',
          z.looseObject({ cwd: z.string(), branch: z.string() }),
          args,
        );
        const exists = await GitService.remoteBranchExists(args.cwd, args.branch);
        return { success: true, data: exists };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  ipcMain.handle('git:checkoutBranch', async (_event, args: { cwd: string; branch: string }) => {
    try {
      parseArgs('git:checkoutBranch', z.looseObject({ cwd: z.string(), branch: z.string() }), args);
      await GitService.checkoutBranch(args.cwd, args.branch);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(
    'git:updateBranchToRemote',
    async (_event, args: { cwd: string; branch: string }) => {
      try {
        parseArgs(
          'git:updateBranchToRemote',
          z.looseObject({ cwd: z.string(), branch: z.string() }),
          args,
        );
        await GitService.updateBranchToRemote(args.cwd, args.branch);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle('git:listBranches', async (_event, cwd: string) => {
    try {
      parseArgs('git:listBranches', z.string(), cwd);
      const branches = await GitService.fetchAndListBranches(cwd);
      return { success: true, data: branches };
    } catch (error) {
      const err = error as { stderr?: string };
      const stderr = err.stderr?.split('\n')[0]?.trim();
      return {
        success: false,
        error: stderr || (error instanceof Error ? error.message : String(error)),
      };
    }
  });

  // Get commit graph for all branches
  ipcMain.handle(
    'git:getCommitGraph',
    async (_event, args: { cwd: string; limit?: number; skip?: number }) => {
      try {
        parseArgs(
          'git:getCommitGraph',
          z.looseObject({
            cwd: z.string(),
            limit: z.number().optional(),
            skip: z.number().optional(),
          }),
          args,
        );
        const data = await GitService.getCommitGraph(args.cwd, args.limit, args.skip);
        return { success: true, data };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // Get detailed info for a single commit
  ipcMain.handle('git:getCommitDetail', async (_event, args: { cwd: string; hash: string }) => {
    try {
      parseArgs('git:getCommitDetail', z.looseObject({ cwd: z.string(), hash: z.string() }), args);
      const data = await GitService.getCommitDetail(args.cwd, args.hash);
      return { success: true, data };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Start watching a directory for file changes
  ipcMain.handle('git:watch', async (_event, args: { id: string; cwd: string }) => {
    try {
      parseArgs('git:watch', z.looseObject({ id: z.string(), cwd: z.string() }), args);
      startWatching(args.id, args.cwd);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Stop watching a directory
  ipcMain.handle('git:unwatch', async (_event, id: string) => {
    try {
      parseArgs('git:unwatch', z.string(), id);
      stopWatching(id);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
