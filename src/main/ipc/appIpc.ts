import { ipcMain, dialog, app } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export function registerAppIpc(): void {
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:showOpenDialog', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: [] };
      }

      return { success: true, data: result.filePaths };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('app:detectGit', async (_event, folderPath: string) => {
    try {
      const gitDir = path.join(folderPath, '.git');
      if (!fs.existsSync(gitDir)) {
        return { success: true, data: { remote: null, branch: null } };
      }

      let remote: string | null = null;
      let branch: string | null = null;

      try {
        const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
          cwd: folderPath,
        });
        remote = stdout.trim() || null;
      } catch {
        // No remote
      }

      try {
        const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
          cwd: folderPath,
        });
        branch = stdout.trim() || null;
      } catch {
        // No branch
      }

      return { success: true, data: { remote, branch } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('app:checkForUpdates', async () => {
    const { checkForUpdates } = await import('../services/UpdateService');
    checkForUpdates();
  });

  ipcMain.handle('app:downloadUpdate', async () => {
    const { downloadUpdate } = await import('../services/UpdateService');
    downloadUpdate();
  });

  ipcMain.handle('app:installUpdate', async () => {
    const { installUpdate } = await import('../services/UpdateService');
    installUpdate();
  });

  ipcMain.handle('app:detectClaude', async () => {
    try {
      // Import cached result from main
      const { claudeCliCache } = await import('../main');
      return { success: true, data: claudeCliCache };
    } catch (error) {
      return {
        success: true,
        data: { installed: false, version: null, path: null },
      };
    }
  });
}
