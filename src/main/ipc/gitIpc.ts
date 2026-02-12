import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { homedir } from 'os';
import { GitService } from '../services/GitService';
import { startWatching, stopWatching } from '../services/FileWatcherService';

const execFileAsync = promisify(execFile);

export function registerGitIpc(): void {
  // Clone a git repository
  ipcMain.handle('git:clone', async (_event, args: { url: string }) => {
    try {
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
      return { success: false, error: String(error) };
    }
  });

  // Get full git status for a directory
  ipcMain.handle('git:getStatus', async (_event, cwd: string) => {
    try {
      const status = await GitService.getStatus(cwd);
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: String(error) };
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
        const diff = await GitService.getDiff(
          args.cwd,
          args.filePath,
          args.staged,
          args.contextLines,
        );
        return { success: true, data: diff };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Get diff for an untracked file
  ipcMain.handle(
    'git:getDiffUntracked',
    async (_event, args: { cwd: string; filePath: string; contextLines?: number }) => {
      try {
        const diff = await GitService.getDiffUntracked(args.cwd, args.filePath, args.contextLines);
        return { success: true, data: diff };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Stage a file
  ipcMain.handle('git:stageFile', async (_event, args: { cwd: string; filePath: string }) => {
    try {
      await GitService.stageFile(args.cwd, args.filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Stage all files
  ipcMain.handle('git:stageAll', async (_event, cwd: string) => {
    try {
      await GitService.stageAll(cwd);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Unstage a file
  ipcMain.handle('git:unstageFile', async (_event, args: { cwd: string; filePath: string }) => {
    try {
      await GitService.unstageFile(args.cwd, args.filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Unstage all files
  ipcMain.handle('git:unstageAll', async (_event, cwd: string) => {
    try {
      await GitService.unstageAll(cwd);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Discard changes to a file
  ipcMain.handle('git:discardFile', async (_event, args: { cwd: string; filePath: string }) => {
    try {
      await GitService.discardFile(args.cwd, args.filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Commit staged changes
  ipcMain.handle('git:commit', async (_event, args: { cwd: string; message: string }) => {
    try {
      await GitService.commit(args.cwd, args.message);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Push to remote
  ipcMain.handle('git:push', async (_event, cwd: string) => {
    try {
      await GitService.push(cwd);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List remote branches (fetch + list)
  ipcMain.handle('git:listBranches', async (_event, cwd: string) => {
    try {
      const branches = await GitService.fetchAndListBranches(cwd);
      return { success: true, data: branches };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Start watching a directory for file changes
  ipcMain.handle('git:watch', async (_event, args: { id: string; cwd: string }) => {
    try {
      startWatching(args.id, args.cwd);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Stop watching a directory
  ipcMain.handle('git:unwatch', async (_event, id: string) => {
    try {
      stopWatching(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
