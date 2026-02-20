import { ipcMain, dialog, app, shell, BrowserWindow, Notification } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

let cachedEditor: string | null = null;

async function detectEditor(): Promise<string> {
  if (cachedEditor) return cachedEditor;

  // Check environment variables first
  for (const envVar of ['VISUAL', 'EDITOR']) {
    const val = process.env[envVar];
    if (val) {
      cachedEditor = val;
      return val;
    }
  }

  // Probe for known editors
  for (const editor of ['cursor', 'code', 'zed']) {
    try {
      await execFileAsync('which', [editor]);
      cachedEditor = editor;
      return editor;
    } catch {
      // Not found, try next
    }
  }

  // Fallback to macOS open
  cachedEditor = 'open';
  return 'open';
}

export function registerAppIpc(): void {
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
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

  ipcMain.handle(
    'app:openInEditor',
    async (_event, args: { cwd: string; filePath: string; line?: number; col?: number }) => {
      try {
        const resolved = path.resolve(args.cwd, args.filePath);
        if (!fs.existsSync(resolved)) {
          return { success: false, error: `File not found: ${resolved}` };
        }

        const editor = await detectEditor();

        // Build location string with line:col for editors that support -g
        const gotoEditors = ['code', 'cursor', 'zed'];
        const isGotoEditor = gotoEditors.some((e) => editor === e || editor.endsWith(`/${e}`));

        if (isGotoEditor) {
          const location =
            args.line != null && args.col != null
              ? `${resolved}:${args.line}:${args.col}`
              : args.line != null
                ? `${resolved}:${args.line}`
                : resolved;
          await execFileAsync(editor, ['-g', location]);
        } else if (editor === 'open') {
          await execFileAsync('open', [resolved]);
        } else {
          // Generic editor (vim, nano, etc.) — just open the file
          await execFileAsync(editor, [resolved]);
        }

        return { success: true, data: null };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );
}
