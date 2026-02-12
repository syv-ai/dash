import { ipcMain, dialog, app, BrowserWindow, Notification } from 'electron';
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
      const win = BrowserWindow.getFocusedWindow();
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
        : await dialog.showOpenDialog({ properties: ['openDirectory'] });

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

  ipcMain.on('app:setDesktopNotification', async (_event, opts: { enabled: boolean }) => {
    const { setDesktopNotification } = await import('../services/ptyManager');
    setDesktopNotification(opts);

    // Fire a test notification when newly enabled so macOS prompts for permission
    if (opts.enabled) {
      try {
        const n = new Notification({
          title: 'Dash',
          body: 'Notifications enabled!',
        });
        n.show();
      } catch {
        // Ignore — user may have denied permission
      }
    }
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
